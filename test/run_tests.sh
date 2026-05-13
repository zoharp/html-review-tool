#!/bin/bash
# ============================================================
#  HTML Review Tool — end-to-end test suite
#  Usage:  bash test/run_tests.sh
#  Requires: curl, node (with project deps installed)
# ============================================================

PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail(){ echo "  ✗ $1  →  ${2:0:120}"; FAIL=$((FAIL+1)); }
chk() { echo "$3" | grep -q "$2" && ok "$1" || fail "$1" "$3"; }

cd "$(dirname "$0")/.."

# ── Temp files ──────────────────────────────────────────────
DB=/tmp/rv_test.db
AC=/tmp/rv_admin.txt      # admin cookie jar
IDS=/tmp/rv_ids.json

rm -f "$DB" "$AC" "$IDS"

# ── Write test .env (backed up if real one exists) ──────────
ENV_FILE=".env"
ENV_BAK="/tmp/rv_env_backup"
[ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$ENV_BAK"

cat > "$ENV_FILE" << 'EOF'
PORT=3099
ADMIN_PASSWORD=testpass123
SMTP_HOST=localhost
SMTP_PORT=25
SMTP_USER=noreply@test.com
SMTP_PASS=unused
SMTP_FROM=noreply@test.com
BASE_URL=http://localhost:3099
DB_PATH=/tmp/rv_test.db
EOF

# ── Start server ─────────────────────────────────────────────
node server.js >/tmp/rv_srv.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; [ -f "$ENV_BAK" ] && cp "$ENV_BAK" "$ENV_FILE" && echo "  .env restored"' EXIT

READY=0
for i in $(seq 1 20); do
  sleep 0.5
  C=$(curl -s -o/dev/null -w "%{http_code}" http://localhost:3099/api/admin/me 2>/dev/null)
  [ "$C" = "401" ] && { READY=1; echo "=== Server ready (attempt $i) ==="; break; }
done
[ $READY -eq 0 ] && { echo "ERROR: server did not start"; cat /tmp/rv_srv.log; exit 1; }

# ────────────────────────────────────────────────────────────
echo; echo "── AUTH ──"
chk "/me unauthed → 401" "401" \
  "$(curl -s -o/dev/null -w"%{http_code}" http://localhost:3099/api/admin/me)"
chk "bad password → 401" "401" \
  "$(curl -s -o/dev/null -w"%{http_code}" -XPOST http://localhost:3099/api/admin/login \
     -H'Content-Type:application/json' -d'{"password":"wrong"}')"
LOGIN=$(curl -s -c"$AC" -XPOST http://localhost:3099/api/admin/login \
  -H'Content-Type:application/json' -d'{"password":"testpass123"}')
chk "correct password → ok" '"ok"' "$LOGIN"
chk "/me authed → 200" "200" \
  "$(curl -s -b"$AC" -o/dev/null -w"%{http_code}" http://localhost:3099/api/admin/me)"

# ────────────────────────────────────────────────────────────
echo; echo "── FILE UPLOAD ──"
HTML='<html><body><p>Hello World. This is sample text for review here.</p></body></html>'
UPLOAD=$(curl -s -b"$AC" -XPOST http://localhost:3099/api/admin/files \
  -F "file=@-;filename=test.html;type=text/html" <<< "$HTML")
chk "upload → has id" '"id"' "$UPLOAD"
FILE_ID=$(echo "$UPLOAD" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
chk "file list → test.html" "test.html" \
  "$(curl -s -b"$AC" http://localhost:3099/api/admin/files)"

# ────────────────────────────────────────────────────────────
echo; echo "── SEED DB (invites, annotations, replies) ──"
node << JSEOF
const S=require('sql.js'), fs=require('fs'), {v4:u}=require('uuid');
S().then(SQL=>{
  const db=new SQL.Database(fs.readFileSync('/tmp/rv_test.db'));
  const fid=db.exec("SELECT id FROM files LIMIT 1")[0].values[0][0];
  const [iid,tok,a1,a2,rid]=[u(),u(),u(),u(),u()];
  db.run('INSERT INTO invites(id,file_id,email,name,invite_code,status)VALUES(?,?,?,?,?,?)',
    [iid,fid,'reviewer@test.com','Test Reviewer','INVITE_CODE_1','accepted']);
  db.run('INSERT INTO sessions(token,invite_id,email,file_id)VALUES(?,?,?,?)',
    [tok,iid,'reviewer@test.com',fid]);
  db.run('INSERT INTO annotations(id,file_id,invite_id,reviewer_email,reviewer_name,type,selected_text,context_before,comment,status)VALUES(?,?,?,?,?,?,?,?,?,?)',
    [a1,fid,iid,'reviewer@test.com','Test Reviewer','comment','Hello World','','Great intro!','pending']);
  db.run('INSERT INTO annotations(id,file_id,invite_id,reviewer_email,reviewer_name,type,selected_text,context_before,suggested_text,status)VALUES(?,?,?,?,?,?,?,?,?,?)',
    [a2,fid,iid,'reviewer@test.com','Test Reviewer','change','sample text','is ','example content','pending']);
  db.run('INSERT INTO replies(id,annotation_id,author_email,author_name,author_role,message)VALUES(?,?,?,?,?,?)',
    [rid,a1,'admin','Admin','admin','Seeded admin reply']);
  fs.writeFileSync('/tmp/rv_test.db', Buffer.from(db.export()));
  fs.writeFileSync('/tmp/rv_ids.json', JSON.stringify({fid,tok,a1,a2,rid}));
  console.log('  seeded ok — file=' + fid);
});
JSEOF

IDS=$(cat "$IDS")
FID=$(node -p "JSON.parse(process.argv[1]).fid" "$IDS")
A1=$(node  -p "JSON.parse(process.argv[1]).a1"  "$IDS")
A2=$(node  -p "JSON.parse(process.argv[1]).a2"  "$IDS")
TOK=$(node -p "JSON.parse(process.argv[1]).tok" "$IDS")

# ────────────────────────────────────────────────────────────
echo; echo "── ADMIN ANNOTATIONS ──"
chk "list annotations" "Great intro" \
  "$(curl -s -b"$AC" "http://localhost:3099/api/admin/annotations?fileId=$FID")"
chk "accept annotation → ok" '"ok"' \
  "$(curl -s -XPATCH -b"$AC" "http://localhost:3099/api/admin/annotations/$A1" \
     -H'Content-Type:application/json' -d'{"status":"accepted"}')"
chk "reject annotation → ok" '"ok"' \
  "$(curl -s -XPATCH -b"$AC" "http://localhost:3099/api/admin/annotations/$A1" \
     -H'Content-Type:application/json' -d'{"status":"rejected"}')"
chk "reset to pending → ok" '"ok"' \
  "$(curl -s -XPATCH -b"$AC" "http://localhost:3099/api/admin/annotations/$A1" \
     -H'Content-Type:application/json' -d'{"status":"pending"}')"
chk "invalid status → 400" "400" \
  "$(curl -s -o/dev/null -w"%{http_code}" -XPATCH -b"$AC" \
     "http://localhost:3099/api/admin/annotations/$A1" \
     -H'Content-Type:application/json' -d'{"status":"bogus"}')"

# Accept the change annotation so export test has something to apply
curl -s -XPATCH -b"$AC" "http://localhost:3099/api/admin/annotations/$A2" \
  -H'Content-Type:application/json' -d'{"status":"accepted"}' >/dev/null

# ────────────────────────────────────────────────────────────
echo; echo "── EXPORT ──"
chk "export → 200" "200" \
  "$(curl -s -b"$AC" -o/dev/null -w"%{http_code}" "http://localhost:3099/api/admin/files/$FID/export")"
EXP=$(curl -s -b"$AC" "http://localhost:3099/api/admin/files/$FID/export")
chk "export applies accepted change" "example content" "$EXP"
chk "export is HTML" "<html" "$EXP"
chk "export has revised filename" "_revised.html" \
  "$(curl -sI -b"$AC" "http://localhost:3099/api/admin/files/$FID/export")"

# ────────────────────────────────────────────────────────────
echo; echo "── PREVIEW ──"
chk "preview → 200" "200" \
  "$(curl -s -b"$AC" -o/dev/null -w"%{http_code}" "http://localhost:3099/api/admin/preview/file/$FID")"
PRV=$(curl -s -b"$AC" "http://localhost:3099/api/admin/preview/file/$FID")
chk "preview injects overlay styles" "__ann_styles__" "$PRV"
chk "preview uses admin annotations API" "admin/annotations" "$PRV"

# ────────────────────────────────────────────────────────────
echo; echo "── REPLIES (admin) ──"
chk "get replies → seeded reply" "Seeded admin reply" \
  "$(curl -s -b"$AC" "http://localhost:3099/api/admin/annotations/$A1/replies")"
chk "post reply → ok" '"ok"' \
  "$(curl -s -XPOST -b"$AC" "http://localhost:3099/api/admin/annotations/$A1/replies" \
     -H'Content-Type:application/json' -d'{"message":"Second reply"}')"
chk "2 replies now" "Second reply" \
  "$(curl -s -b"$AC" "http://localhost:3099/api/admin/annotations/$A1/replies")"
chk "empty message → 400" "400" \
  "$(curl -s -o/dev/null -w"%{http_code}" -XPOST -b"$AC" \
     "http://localhost:3099/api/admin/annotations/$A1/replies" \
     -H'Content-Type:application/json' -d'{"message":""}')"

# ────────────────────────────────────────────────────────────
echo; echo "── REVIEWER SESSION ──"
chk "reviewer /me → email" "reviewer@test.com" \
  "$(curl -s -b"reviewer_token=$TOK" http://localhost:3099/api/reviewer/me)"
chk "reviewer file → 200" "200" \
  "$(curl -s -b"reviewer_token=$TOK" -o/dev/null -w"%{http_code}" \
     "http://localhost:3099/api/reviewer/file/$FID")"
RFB=$(curl -s -b"reviewer_token=$TOK" "http://localhost:3099/api/reviewer/file/$FID")
chk "reviewer file has overlay" "__ann_styles__" "$RFB"
chk "reviewer file uses reviewer API" "reviewer/annotations" "$RFB"
chk "reviewer annotation list" "Great intro" \
  "$(curl -s -b"reviewer_token=$TOK" "http://localhost:3099/api/reviewer/annotations/$FID")"
chk "reviewer get replies" "Seeded admin reply" \
  "$(curl -s -b"reviewer_token=$TOK" "http://localhost:3099/api/reviewer/annotations/$A1/replies")"
chk "reviewer post reply → ok" '"ok"' \
  "$(curl -s -XPOST -b"reviewer_token=$TOK" \
     "http://localhost:3099/api/reviewer/annotations/$A1/replies" \
     -H'Content-Type:application/json' -d'{"message":"Reviewer says hi"}')"
chk "reviewer blocked from other file → 403" "403" \
  "$(curl -s -o/dev/null -w"%{http_code}" -b"reviewer_token=$TOK" \
     "http://localhost:3099/api/reviewer/annotations/does-not-exist")"

# ────────────────────────────────────────────────────────────
echo; echo "── INVITE FLOW ──"
chk "invite code redirect" "302\|login.html" \
  "$(curl -s -o/dev/null -w"%{http_code}" http://localhost:3099/review/invite/INVITE_CODE_1)"
chk "bad invite code → HTML error page" "Invalid" \
  "$(curl -s http://localhost:3099/review/invite/BADCODE)"
chk "reviewer auth with correct code → ok" '"ok"' \
  "$(curl -s -XPOST http://localhost:3099/api/reviewer/auth \
     -H'Content-Type:application/json' \
     -d'{"email":"reviewer@test.com","inviteCode":"INVITE_CODE_1"}')"

# ────────────────────────────────────────────────────────────
echo; echo "── STATIC FILES ──"
for F in admin.html reviewer.html preview.html login.html; do
  chk "$F → 200" "200" "$(curl -s -o/dev/null -w"%{http_code}" "http://localhost:3099/$F")"
done
chk "/ → redirect → 200" "200" \
  "$(curl -s -L -o/dev/null -w"%{http_code}" http://localhost:3099/)"


# ────────────────────────────────────────────────────────────
echo; echo "── ADMIN ANNOTATIONS (Preview Mode) ──"
chk "admin post annotation → has id" '"id"' \
  "$(curl -s -XPOST -b"$AC" http://localhost:3099/api/admin/annotations \
     -H'Content-Type:application/json' -d '{"fileId":"'"$FID"'","type":"comment","selectedText":"Hello","comment":"admin test"}')"
A_ADMIN=$(curl -s -XPOST -b"$AC" http://localhost:3099/api/admin/annotations \
  -H'Content-Type:application/json' -d '{"fileId":"'"$FID"'","type":"comment","selectedText":"Hello","comment":"admin test"}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
chk "admin annotation in list" "admin test" \
  "$(curl -s -b"$AC" "http://localhost:3099/api/admin/annotations?fileId=$FID")"
chk "admin annotation status change" '"ok"' \
  "$(curl -s -XPATCH -b"$AC" "http://localhost:3099/api/admin/annotations/$A_ADMIN" \
     -H'Content-Type:application/json' -d '{"status":"accepted"}')"
# ────────────────────────────────────────────────────────────
echo; echo "── RATE LIMITER ──"
for i in $(seq 1 11); do
  curl -s -o/dev/null -XPOST http://localhost:3099/api/admin/login \
    -H'Content-Type:application/json' -d'{"password":"bad"}' &
done; wait
chk "rate limiter → 429 after 11 bad logins" "429" \
  "$(curl -s -o/dev/null -w"%{http_code}" -XPOST http://localhost:3099/api/admin/login \
     -H'Content-Type:application/json' -d'{"password":"bad"}')"

# ────────────────────────────────────────────────────────────
echo
echo "══════════════════════════════════"
printf "  ✓ PASSED : %d\n" $PASS
printf "  ✗ FAILED : %d\n" $FAIL
echo "══════════════════════════════════"
[ $FAIL -eq 0 ]
