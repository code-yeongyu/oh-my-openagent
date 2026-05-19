#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "typer>=0.12.0",
#     "rich>=13.0.0",
# ]
# ///
"""
GitHub Issues/PRs Fetcher with Exhaustive Pagination.

Fetches ALL issues and/or PRs from a GitHub repository using gh CLI.
Implements proper pagination to ensure no items are missed.

Usage:
    ./gh_fetch.py issues                    # Fetch all issues
    ./gh_fetch.py prs                       # Fetch all PRs
    ./gh_fetch.py all                       # Fetch both issues and PRs
    ./gh_fetch.py issues --hours 48         # Issues from last 48 hours
    ./gh_fetch.py prs --state open          # Only open PRs
    ./gh_fetch.py all --repo owner/repo     # Specify repository
"""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import Annotated

import typer
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, TaskID
from rich.table import Table

app = typer.Typer(
    name="gh_fetch",
    help="Fetch GitHub issues/PRs with exhaustive pagination.",
    no_args_is_help=True,
)
console = Console()

BATCH_SIZE = 500  # Maximum allowed by GitHub API


class ItemState(str, Enum):
    ALL = "all"
    OPEN = "open"
    CLOSED = "closed"


class OutputFormat(str, Enum):
    JSON = "json"
    TABLE = "table"
    COUNT = "count"


async def run_gh_command(args: list[str]) -> tuple[str, str, int]:
    """Run gh CLI command asynchronously."""
    proc = await asyncio.create_subprocess_exec(
        "gh",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return stdout.decode(), stderr.decode(), proc.returncode or 0


async def get_current_repo() -> str:
    """Get the current repository from gh CLI."""
    stdout, stderr, code = await run_gh_command(
        ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]
    )
    if code != 0:
        console.print(f"[red]Error getting current repo: {stderr}[/red]")
        raise typer.Exit(1)
    return stdout.strip()


async def fetch_items_page(
    repo: str,
    item_type: str,  # "issue" or "pr"
    state: str,
    limit: int,
    search_filter: str = "",
) -> list[dict]:
    """Fetch a single page of issues or PRs."""
    cmd = [
        item_type,
        "list",
        "--repo",
        repo,
        "--state",
        state,
        "--limit",
        str(limit),
        "--json",
        "number,title,state,createdAt,updatedAt,labels,author,body",
    ]
    if search_filter:
        cmd.extend(["--search", search_filter])

    stdout, stderr, code = await run_gh_command(cmd)
    if code != 0:
        console.print(f"[red]Error fetching {item_type}s: {stderr}[/red]")
        return []

    try:
        return json.loads(stdout) if stdout.strip() else []
    except json.JSONDecodeError:
        console.print(f"[red]Error parsing {item_type} response[/red]")
        return []


async def fetch_all_items(
    repo: str,
    item_type: str,
    state: str,
    hours: int | None,
    progress: Progress,
    task_id: TaskID,
) -> list[dict]:
    """Fetch ALL items with exhaustive pagination."""
    all_items: list[dict] = []
    page = 1

    progress.update(task_id, description=f"[cyan]Fetching {item_type}s page {page}...")
    items = await fetch_items_page(repo, item_type, state, BATCH_SIZE)
    fetched_count = len(items)
    all_items.extend(items)

    console.print(f"[dim]Page {page}: fetched {fetched_count} {item_type}s[/dim]")

    while fetched_count == BATCH_SIZE:
        page += 1
        progress.update(
            task_id, description=f"[cyan]Fetching {item_type}s page {page}..."
        )

        last_created = all_items[-1].get("createdAt", "")
        if not last_created:
            break

        search_filter = f"created:<{last_created}"
        items = await fetch_items_page(
            repo, item_type, state, BATCH_SIZE, search_filter
        )
        fetched_count = len(items)

        if fetched_count == 0:
            break

        existing_numbers = {item["number"] for item in all_items}
        new_items = [item for item in items if item["number"] not in existing_numbers]
        all_items.extend(new_items)

        console.print(
            f"[dim]Page {page}: fetched {fetched_count}, added {len(new_items)} new (total: {len(all_items)})[/dim]"
        )

        if page > 20:
            console.print("[yellow]Safety limit reached (20 pages)[/yellow]")
            break

    if hours is not None:
        cutoff = datetime.now(UTC) - timedelta(hours=hours)
        cutoff_str = cutoff.isoformat()

        original_count = len(all_items)
        all_items = [
            item
            for item in all_items
            if item.get("createdAt", "") >= cutoff_str
            or item.get("updatedAt", "") >= cutoff_str
        ]
        filtered_count = original_count - len(all_items)
        if filtered_count > 0:
            console.print(
                f"[dim]Filtered out {filtered_count} items older than {hours} hours[/dim]"
            )

    return all_items


def display_table(items: list[dict], item_type: str) -> None:
    """Display items in a Rich table."""
    table = Table(title=f"{item_type.upper()}s ({len(items)} total)")
    table.add_column("#", style="cyan", width=6)
    table.add_column("Title", style="white", max_width=50)
    table.add_column("State", style="green", width=8)
    table.add_column("Author", style="yellow", width=15)
    table.add_column("Labels", style="magenta", max_width=30)
    table.add_column("Updated", style="dim", width=12)

    for item in items[:50]:
        labels = ", ".join(label.get("name", "") for label in item.get("labels", []))
        updated = item.get("updatedAt", "")[:10]
        author = item.get("author", {}).get("login", "unknown")

        table.add_row(
            str(item.get("number", "")),
            (item.get("title", "")[:47] + "...")
            if len(item.get("title", "")) > 50
            else item.get("title", ""),
            item.get("state", ""),
            author,
            (labels[:27] + "...") if len(labels) > 30 else labels,
            updated,
        )

    console.print(table)
    if len(items) > 50:
        console.print(f"[dim]... and {len(items) - 50} more items[/dim]")


@app.command()
def issues(
    repo: Annotated[
        str | None, typer.Option("--repo", "-r", help="Repository (owner/repo)")
    ] = None,
    state: Annotated[
        ItemState, typer.Option("--state", "-s", help="Issue state filter")
    ] = ItemState.ALL,
    hours: Annotated[
        int | None,
        typer.Option(
            "--hours", "-h", help="Only issues from last N hours (created or updated)"
        ),
    ] = None,
    output: Annotated[
        OutputFormat, typer.Option("--output", "-o", help="Output format")
    ] = OutputFormat.TABLE,
) -> None:
    """Fetch all issues with exhaustive pagination."""

    async def async_main() -> None:
        target_repo = repo or await get_current_repo()

        console.print(f"""
[cyan]Repository:[/cyan] {target_repo}
[cyan]State:[/cyan] {state.value}
[cyan]Time filter:[/cyan] {f"Last {hours} hours" if hours else "All time"}
""")

        with Progress(console=console) as progress:
            task: TaskID = progress.add_task("[cyan]Fetching issues...", total=None)
            items = await fetch_all_items(
                target_repo, "issue", state.value, hours, progress, task
            )
            progress.update(
                task, description="[green]Complete!", completed=100, total=100
            )

        console.print(
            Panel(f"[green]Found {len(items)} issues[/green]", border_style="green")
        )

        if output == OutputFormat.JSON:
            console.print(json.dumps(items, indent=2, ensure_ascii=False))
        elif output == OutputFormat.TABLE:
            display_table(items, "issue")
        else:
            console.print(f"Total issues: {len(items)}")

    asyncio.run(async_main())


@app.command()
def prs(
    repo: Annotated[
        str | None, typer.Option("--repo", "-r", help="Repository (owner/repo)")
    ] = None,
    state: Annotated[
        ItemState, typer.Option("--state", "-s", help="PR state filter")
    ] = ItemState.OPEN,
    hours: Annotated[
        int | None,
        typer.Option(
            "--hours", "-h", help="Only PRs from last N hours (created or updated)"
        ),
    ] = None,
    output: Annotated[
        OutputFormat, typer.Option("--output", "-o", help="Output format")
    ] = OutputFormat.TABLE,
) -> None:
    """Fetch all PRs with exhaustive pagination."""

    async def async_main() -> None:
        target_repo = repo or await get_current_repo()

        console.print(f"""
[cyan]Repository:[/cyan] {target_repo}
[cyan]State:[/cyan] {state.value}
[cyan]Time filter:[/cyan] {f"Last {hours} hours" if hours else "All time"}
""")

        with Progress(console=console) as progress:
            task: TaskID = progress.add_task("[cyan]Fetching PRs...", total=None)
            items = await fetch_all_items(
                target_repo, "pr", state.value, hours, progress, task
            )
            progress.update(
                task, description="[green]Complete!", completed=100, total=100
            )

        console.print(
            Panel(f"[green]Found {len(items)} PRs[/green]", border_style="green")
        )

        if output == OutputFormat.JSON:
            console.print(json.dumps(items, indent=2, ensure_ascii=False))
        elif output == OutputFormat.TABLE:
            display_table(items, "pr")
        else:
            console.print(f"Total PRs: {len(items)}")

    asyncio.run(async_main())


@app.command(name="all")
def fetch_all(
    repo: Annotated[
        str | None, typer.Option("--repo", "-r", help="Repository (owner/repo)")
    ] = None,
    state: Annotated[
        ItemState, typer.Option("--state", "-s", help="State filter")
    ] = ItemState.ALL,
    hours: Annotated[
        int | None,
        typer.Option(
            "--hours", "-h", help="Only items from last N hours (created or updated)"
        ),
    ] = None,
    output: Annotated[
        OutputFormat, typer.Option("--output", "-o", help="Output format")
    ] = OutputFormat.TABLE,
) -> None:
    """Fetch all issues AND PRs with exhaustive pagination."""

    async def async_main() -> None:
        target_repo = repo or await get_current_repo()

        console.print(f"""
[cyan]Repository:[/cyan] {target_repo}
[cyan]State:[/cyan] {state.value}
[cyan]Time filter:[/cyan] {f"Last {hours} hours" if hours else "All time"}
[cyan]Fetching:[/cyan] Issues AND PRs
""")

        with Progress(console=console) as progress:
            issues_task: TaskID = progress.add_task(
                "[cyan]Fetching issues...", total=None
            )
            prs_task: TaskID = progress.add_task("[cyan]Fetching PRs...", total=None)

            issues_items, prs_items = await asyncio.gather(
                fetch_all_items(
                    target_repo, "issue", state.value, hours, progress, issues_task
                ),
                fetch_all_items(
                    target_repo, "pr", state.value, hours, progress, prs_task
                ),
            )

            progress.update(
                issues_task,
                description="[green]Issues complete!",
                completed=100,
                total=100,
            )
            progress.update(
                prs_task, description="[green]PRs complete!", completed=100, total=100
            )

        console.print(
            Panel(
                f"[green]Found {len(issues_items)} issues and {len(prs_items)} PRs[/green]",
                border_style="green",
            )
        )

        if output == OutputFormat.JSON:
            result = {"issues": issues_items, "prs": prs_items}
            console.print(json.dumps(result, indent=2, ensure_ascii=False))
        elif output == OutputFormat.TABLE:
            display_table(issues_items, "issue")
            console.print("")
            display_table(prs_items, "pr")
        else:
            console.print(f"Total issues: {len(issues_items)}")
            console.print(f"Total PRs: {len(prs_items)}")

    asyncio.run(async_main())


if __name__ == "__main__":
    app()
