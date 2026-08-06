from __future__ import annotations

SQL_LIKE_ESCAPE = "\\"


class CookieDomainError(ValueError):
    pass


def normalize_cookie_domain(domain: str) -> str:
    normalized = domain.strip().lower().lstrip(".")
    if not normalized:
        raise CookieDomainError("cookie domain must not be empty")
    return normalized


def escape_sql_like(value: str) -> str:
    return (
        value
        .replace(SQL_LIKE_ESCAPE, SQL_LIKE_ESCAPE * 2)
        .replace("%", f"{SQL_LIKE_ESCAPE}%")
        .replace("_", f"{SQL_LIKE_ESCAPE}_")
    )


def domain_where_clause(column: str, domains: list[str]) -> tuple[str, list[str]]:
    normalized_domains = sorted({normalize_cookie_domain(domain) for domain in domains})
    if not normalized_domains:
        raise CookieDomainError("at least one cookie domain is required")

    clauses: list[str] = []
    params: list[str] = []
    for domain in normalized_domains:
        clauses.append(
            f"({column} = ? OR {column} = ? OR {column} LIKE ? ESCAPE '{SQL_LIKE_ESCAPE}')"
        )
        params.extend([domain, f".{domain}", f"%.{escape_sql_like(domain)}"])
    return " OR ".join(clauses), params
