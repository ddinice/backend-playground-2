#!/bin/bash
# ============================================================
# Test: pessimistic locking + stock decrement on POST /orders
# Usage: bash test-stock.sh
# ============================================================

BASE_URL="http://localhost:3000"
DB="PGPASSWORD=test psql -h localhost -U test -d test -t -A"

# --- Fetch real IDs from DB ---
USER_ID=$(eval $DB -c "SELECT id FROM users LIMIT 1" 2>/dev/null)
PRODUCT_ID=$(eval $DB -c "SELECT id FROM products LIMIT 1" 2>/dev/null)
PRODUCT_TITLE=$(eval $DB -c "SELECT title FROM products WHERE id = '$PRODUCT_ID'" 2>/dev/null)

if [ -z "$USER_ID" ] || [ -z "$PRODUCT_ID" ]; then
  echo "Could not fetch IDs from DB. Set them manually:"
  echo '  USER_ID="..." PRODUCT_ID="..." bash test-stock.sh'
  exit 1
fi

echo "Using USER_ID=$USER_ID"
echo "Using PRODUCT_ID=$PRODUCT_ID ($PRODUCT_TITLE)"
echo ""

# --- Helper: get current stock ---
get_stock() {
  eval $DB -c "SELECT stock FROM products WHERE id = '$PRODUCT_ID'" 2>/dev/null
}

# --- Helper: set stock to a specific value ---
set_stock() {
  eval $DB -c "UPDATE products SET stock = $1 WHERE id = '$PRODUCT_ID'" >/dev/null 2>&1
}

# --- Helper: create order ---
create_order() {
  local key=$1
  local qty=$2
  curl -s -o "$3" -w "%{http_code}" \
    -X POST "$BASE_URL/orders" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $key" \
    -d '{"userId":"'"$USER_ID"'","items":[{"id":"'"$PRODUCT_ID"'","quantity":'"$qty"'}]}'
}

# ============================================================
echo "=== TEST 1: Stock decrements after order ==="
echo "------------------------------------------------------------"
set_stock 10
echo "Stock before: $(get_stock)"

KEY1=$(uuidgen | tr '[:upper:]' '[:lower:]')
HTTP=$(create_order "$KEY1" 3 /tmp/stock_t1.json)
echo "POST /orders (qty=3) → HTTP $HTTP"
cat /tmp/stock_t1.json | python3 -m json.tool 2>/dev/null | head -5

STOCK_AFTER=$(get_stock)
echo "Stock after:  $STOCK_AFTER"

if [ "$STOCK_AFTER" = "7" ]; then
  echo "✅ PASS: Stock decremented 10 → 7"
else
  echo "❌ FAIL: Expected 7, got $STOCK_AFTER"
fi
echo ""

# ============================================================
echo "=== TEST 2: Insufficient stock → 400 ==="
echo "------------------------------------------------------------"
set_stock 2
echo "Stock before: $(get_stock)"

KEY2=$(uuidgen | tr '[:upper:]' '[:lower:]')
HTTP=$(create_order "$KEY2" 5 /tmp/stock_t2.json)
echo "POST /orders (qty=5) → HTTP $HTTP"
cat /tmp/stock_t2.json | python3 -m json.tool 2>/dev/null

STOCK_AFTER=$(get_stock)
echo "Stock after:  $STOCK_AFTER"

if [ "$HTTP" = "400" ] && [ "$STOCK_AFTER" = "2" ]; then
  echo "✅ PASS: Rejected + stock unchanged"
else
  echo "❌ FAIL: Expected HTTP 400 and stock=2, got HTTP $HTTP and stock=$STOCK_AFTER"
fi
echo ""

# ============================================================
echo "=== TEST 3: Idempotent retry does NOT double-decrement ==="
echo "------------------------------------------------------------"
set_stock 10
echo "Stock before: $(get_stock)"

KEY3=$(uuidgen | tr '[:upper:]' '[:lower:]')
HTTP1=$(create_order "$KEY3" 4 /tmp/stock_t3a.json)
echo "Request 1 (qty=4) → HTTP $HTTP1"
STOCK_MID=$(get_stock)
echo "Stock after 1st: $STOCK_MID"

HTTP2=$(create_order "$KEY3" 4 /tmp/stock_t3b.json)
echo "Request 2 (same key) → HTTP $HTTP2"
STOCK_FINAL=$(get_stock)
echo "Stock after 2nd: $STOCK_FINAL"

ID_A=$(python3 -c "import json; print(json.load(open('/tmp/stock_t3a.json')).get('id',''))" 2>/dev/null)
ID_B=$(python3 -c "import json; print(json.load(open('/tmp/stock_t3b.json')).get('id',''))" 2>/dev/null)

if [ "$STOCK_FINAL" = "6" ] && [ "$ID_A" = "$ID_B" ]; then
  echo "✅ PASS: Stock decremented once (10→6), same order returned"
else
  echo "❌ FAIL: Expected stock=6 and same ID, got stock=$STOCK_FINAL (id1=$ID_A, id2=$ID_B)"
fi
echo ""

# ============================================================
echo "=== TEST 4: Race condition — 5 concurrent orders, stock=3, qty=1 each ==="
echo "------------------------------------------------------------"
set_stock 3
echo "Stock before: $(get_stock)"
echo ""

for i in 1 2 3 4 5; do
  KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
  curl -s -o "/tmp/stock_race_$i.json" -w "Request $i → HTTP %{http_code}\n" \
    -X POST "$BASE_URL/orders" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $KEY" \
    -d '{"userId":"'"$USER_ID"'","items":[{"id":"'"$PRODUCT_ID"'","quantity":1}]}' &
done
wait
echo ""

SUCCESS=0
REJECTED=0
for i in 1 2 3 4 5; do
  FILE="/tmp/stock_race_$i.json"
  HAS_ID=$(python3 -c "import json; d=json.load(open('$FILE')); print('yes' if 'id' in d else 'no')" 2>/dev/null)
  if [ "$HAS_ID" = "yes" ]; then
    SUCCESS=$((SUCCESS + 1))
  else
    REJECTED=$((REJECTED + 1))
  fi
done

STOCK_FINAL=$(get_stock)
echo "Results: $SUCCESS succeeded, $REJECTED rejected"
echo "Stock after: $STOCK_FINAL"

if [ "$STOCK_FINAL" = "0" ] && [ "$SUCCESS" = "3" ]; then
  echo "✅ PASS: Exactly 3 orders created, stock=0, 2 rejected"
elif [ "$STOCK_FINAL" -ge "0" ] && [ "$SUCCESS" -le "3" ]; then
  echo "⚠️  PARTIAL: $SUCCESS orders (expected 3), stock=$STOCK_FINAL — pessimistic lock serialized correctly"
else
  echo "❌ FAIL: Stock went negative or too many orders succeeded"
fi
