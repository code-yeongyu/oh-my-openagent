# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.8.5] - 2026-02-24

### Added
- **TOON Compression**: Intelligent structured data compression for LLM contexts.
  - Automatically compresses large uniform JSON arrays using the TOON format.
  - Saves significant token usage when dealing with large datasets or tool outputs.
  - Configurable threshold and safety guards to prevent compression of errors or binary data.
  - Integrated across all tool outputs and hook transformations.
