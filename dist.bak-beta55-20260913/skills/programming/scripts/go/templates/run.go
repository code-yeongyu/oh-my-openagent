// Package cmd wires the root command and subcommands.
package cmd

import (
	"context"
	"log/slog"
	"os"
)

// Execute runs the root command. Wire cobra/subcommands here.
func Execute(ctx context.Context) error {
	slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.InfoContext(ctx, "starting")
	return nil
}
