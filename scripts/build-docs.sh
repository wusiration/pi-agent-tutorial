#!/usr/bin/env bash
set -e

echo "=== Building VitePress docs ==="
npm run docs:build

echo "=== Docs built successfully ==="
