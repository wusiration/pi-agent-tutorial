#!/usr/bin/env bash
set -e

echo "=== Installing root dependencies ==="
npm ci

echo "=== Installing backend dependencies ==="
cd playground/backend
npm ci
cd - > /dev/null

echo "=== Installing frontend dependencies ==="
cd playground/frontend
npm ci
cd - > /dev/null

echo "=== Installing all example dependencies ==="
for dir in examples/0*; do
  echo "  → $dir"
  cd "$dir"
  npm ci
  cd - > /dev/null
done

echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  npm run typecheck:examples  # typecheck all examples"
echo "  npm run test:backend         # run backend tests"
echo "  npm run build:all            # build everything"
echo "  npm run docs:dev             # start docs dev server"
