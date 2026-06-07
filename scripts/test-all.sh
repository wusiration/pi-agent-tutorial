#!/usr/bin/env bash
set -e

echo "=== Running backend tests ==="
cd playground/backend
npm test -- --run
cd - > /dev/null

echo "=== All tests passed ==="
