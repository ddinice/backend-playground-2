#!/bin/bash
# ============================================================
# Test script for Idempotency on POST /orders
# Usage: bash test-idempotency.sh
# ============================================================

BASE_URL="http://localhost:3000"

# --- Fetch real IDs from the DB (requires psql) ---
USER_ID=$(PGPASSWORD=test psql -h localhost -U test -d test -t -A -c \
  "SELECT id FROM users LIMIT 1" 2>/dev/null)
PRODUCT_ID=$(PGPASSWORD=test psql -h localhost -U test -d test -t -A -c \
  "SELECT id FROM products LIMIT 1" 2>/dev/null)

if [ -z "$USER_ID" ] || [ -z "$PRODUCT_ID" ]; then
  echo "Could not fetch IDs from DB. Set them manually:"
  echo '  USER_ID="..." PRODUCT_ID="..." bash test-idempotency.sh'
  exit 1
fi

echo "Using USER_ID=$USER_ID"
echo "Using PRODUCT_ID=$PRODUCT_ID"
echo ""

ORDER_BODY='{"userId":"'"$USER_ID"'","items":[{"id":"'"$PRODUCT_ID"'","quantity":2}]}'

# ============================================================
echo "=== TEST 1: No Idempotency-Key header → 400 ==="
echo "------------------------------------------------------------"
HTTP1=$(curl -s -o /tmp/idem_t1.json -w "%{http_code}" \
  -X POST "$BASE_URL/orders" \
  -H "Content-Type: application/json" \
  -d "$ORDER_BODY")
echo "HTTP $HTTP1"
cat /tmp/idem_t1.json | python3 -m json.tool 2>/dev/null || cat /tmp/idem_t1.json
echo ""

# ============================================================
KEY1=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "=== TEST 2: First request with key=$KEY1 → 201 (create) ==="
echo "------------------------------------------------------------"
HTTP2=$(curl -s -o /tmp/idem_t2.json -w "%{http_code}" \
  -X POST "$BASE_URL/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY1" \
  -d "$ORDER_BODY")
echo "HTTP $HTTP2"
ORDER_ID_1=$(python3 -c "import json; print(json.load(open('/tmp/idem_t2.json'))['id'])" 2>/dev/null)
cat /tmp/idem_t2.json | python3 -m json.tool 2>/dev/null || cat /tmp/idem_t2.json
echo ""

# ============================================================
echo "=== TEST 3: Retry same key=$KEY1 → 200 (cached, same order ID) ==="
echo "------------------------------------------------------------"
HTTP3=$(curl -s -o /tmp/idem_t3.json -w "%{http_code}" \
  -X POST "$BASE_URL/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY1" \
  -d "$ORDER_BODY")
echo "HTTP $HTTP3"
ORDER_ID_2=$(python3 -c "import json; print(json.load(open('/tmp/idem_t3.json'))['id'])" 2>/dev/null)
cat /tmp/idem_t3.json | python3 -m json.tool 2>/dev/null || cat /tmp/idem_t3.json
echo ""

if [ "$ORDER_ID_1" = "$ORDER_ID_2" ] && [ -n "$ORDER_ID_1" ]; then
  echo "✅ PASS: Same order returned (id=$ORDER_ID_1)"
else
  echo "❌ FAIL: Different order IDs ($ORDER_ID_1 vs $ORDER_ID_2)"
fi
echo ""

# ============================================================
echo "=== TEST 4: Different key → 201 (new order) ==="
echo "------------------------------------------------------------"
KEY2=$(uuidgen | tr '[:upper:]' '[:lower:]')
HTTP4=$(curl -s -o /tmp/idem_t4.json -w "%{http_code}" \
  -X POST "$BASE_URL/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY2" \
  -d "$ORDER_BODY")
echo "HTTP $HTTP4"
ORDER_ID_3=$(python3 -c "import json; print(json.load(open('/tmp/idem_t4.json'))['id'])" 2>/dev/null)
cat /tmp/idem_t4.json | python3 -m json.tool 2>/dev/null || cat /tmp/idem_t4.json
echo ""

if [ "$ORDER_ID_1" != "$ORDER_ID_3" ] && [ -n "$ORDER_ID_3" ]; then
  echo "✅ PASS: Different key created a new order (id=$ORDER_ID_3)"
else
  echo "❌ FAIL: Expected different order ID"
fi
echo ""

# ============================================================
echo "=== TEST 5: Race condition — 5 concurrent requests, same key ==="
echo "------------------------------------------------------------"
RACE_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "Key: $RACE_KEY"
echo ""

for i in 1 2 3 4 5; do
  curl -s -o "/tmp/idem_race_$i.json" -w "Request $i → HTTP %{http_code}\n" \
    -X POST "$BASE_URL/orders" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $RACE_KEY" \
    -d "$ORDER_BODY" &
done
wait
echo ""

# Collect unique order IDs from successful responses
RACE_IDS=""
CREATED=0
CONFLICT=0
for i in 1 2 3 4 5; do
  FILE="/tmp/idem_race_$i.json"
  OID=$(python3 -c "import json; d=json.load(open('$FILE')); print(d.get('id',''))" 2>/dev/null)
  STATUS=$(python3 -c "import json; d=json.load(open('$FILE')); print(d.get('statusCode',''))" 2>/dev/null)
  if [ -n "$OID" ]; then
    RACE_IDS="$RACE_IDS $OID"
    CREATED=$((CREATED + 1))
  fi
  if [ "$STATUS" = "409" ]; then
    CONFLICT=$((CONFLICT + 1))
  fi
  echo "  Response $i: $(cat "$FILE" | python3 -m json.tool 2>/dev/null | head -5)..."
done

UNIQUE_IDS=$(echo "$RACE_IDS" | tr ' ' '\n' | sort -u | grep -v '^$' | wc -l | xargs)
echo ""
echo "Results: $CREATED succeeded, $CONFLICT got 409 Conflict"
echo "Unique order IDs: $UNIQUE_IDS"

if [ "$UNIQUE_IDS" = "1" ]; then
  echo "✅ PASS: All successful responses returned the same order"
else
  echo "❌ FAIL: Expected exactly 1 unique order ID, got $UNIQUE_IDS"
fi
