#!/bin/bash
# HTML Review Tool — Test Runner & Result Tracker
# Usage: bash test.sh [--watch] [--verbose] [--keep-logs]

set -e
cd "$(dirname "$0")"

# Options
WATCH=0
VERBOSE=0
KEEP_LOGS=0
RESULTS_DIR="test_results"

while [[ $# -gt 0 ]]; do
  case $1 in
    --watch) WATCH=1; shift ;;
    --verbose) VERBOSE=1; shift ;;
    --keep-logs) KEEP_LOGS=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Create results directory
mkdir -p "$RESULTS_DIR"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

run_tests() {
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  LOG_FILE="$RESULTS_DIR/test_${TIMESTAMP}.log"
  SUMMARY_FILE="$RESULTS_DIR/summary_${TIMESTAMP}.txt"

  echo -e "${BLUE}▶ Running tests...${NC}"

  # Run tests, capture output
  if bash test/run_tests.sh > "$LOG_FILE" 2>&1; then
    TEST_RESULT=0
    RESULT_TEXT="${GREEN}✓ PASSED${NC}"
  else
    TEST_RESULT=$?
    RESULT_TEXT="${RED}✗ FAILED${NC}"
  fi

  # Extract summary
  SUMMARY=$(tail -10 "$LOG_FILE" | grep -A 2 "PASSED\|FAILED" || echo "No summary found")

  # Write summary file
  {
    echo "Test Run: $TIMESTAMP"
    echo "Exit Code: $TEST_RESULT"
    echo ""
    echo "$SUMMARY"
  } > "$SUMMARY_FILE"

  # Display results
  echo ""
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  tail -6 "$LOG_FILE"
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo ""
  echo -e "Result: $RESULT_TEXT"
  echo -e "Log: ${YELLOW}$LOG_FILE${NC}"
  echo -e "Summary: ${YELLOW}$SUMMARY_FILE${NC}"

  # Cleanup old logs if not keeping
  if [ $KEEP_LOGS -eq 0 ]; then
    find "$RESULTS_DIR" -name "test_*.log" -mtime +7 -delete 2>/dev/null || true
  fi

  return $TEST_RESULT
}

show_history() {
  echo -e "${BLUE}Recent Test Results:${NC}"
  echo ""
  ls -1t "$RESULTS_DIR"/summary_*.txt 2>/dev/null | head -10 | while read f; do
    TIMESTAMP=$(basename "$f" | sed 's/summary_\(.*\)\.txt/\1/')
    PASSED=$(grep "PASSED" "$f" | head -1 | awk '{print $NF}' || echo "?")
    FAILED=$(grep "FAILED" "$f" | head -1 | awk '{print $NF}' || echo "?")

    if [ "$FAILED" = "0" ]; then
      STATUS="${GREEN}✓${NC}"
    else
      STATUS="${RED}✗${NC}"
    fi

    printf "%-20s %b  %s passed, %s failed\n" "$TIMESTAMP" "$STATUS" "$PASSED" "$FAILED"
  done
}

case $1 in
  history)
    show_history
    ;;
  *)
    if [ $WATCH -eq 1 ]; then
      echo -e "${YELLOW}Watch mode: Re-running tests on file changes${NC}"
      echo "Press Ctrl+C to stop"
      echo ""

      # Initial run
      run_tests || true

      # Watch for changes
      while true; do
        if command -v inotifywait &> /dev/null; then
          # Linux: use inotifywait
          inotifywait -e modify -r server.js public/ test/ 2>/dev/null || true
        else
          # Fallback: poll every 2 seconds
          sleep 2
        fi

        clear
        echo -e "${YELLOW}[$(date +'%H:%M:%S')] Changes detected, re-running...${NC}"
        echo ""
        run_tests || true
        echo ""
      done
    else
      run_tests

      echo ""
      echo -e "${BLUE}Tips:${NC}"
      echo "  bash test.sh history      — show recent results"
      echo "  bash test.sh --watch      — auto-rerun on changes"
      echo "  bash test.sh --verbose    — show full output"
      echo "  bash test.sh --keep-logs  — keep logs longer"
    fi
    ;;
esac
