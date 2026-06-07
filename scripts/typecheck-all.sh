#!/usr/bin/env bash
set -e

echo "=== Typechecking all examples ==="
for dir in examples/0*; do
  echo "  → $dir"
  cd "$dir"
  if [ -f package.json ]; then
    npm run typecheck 2>/dev/null || npx tsc --noEmit
  fi
  cd - > /dev/null
done

echo "=== Typechecking playground/backend ==="
cd playground/backend
npm run build
cd - > /dev/null

echo "=== Typechecking playground/frontend ==="
cd playground/frontend
npm run build
cd - > /dev/null

echo "=== All typechecks passed ==="
