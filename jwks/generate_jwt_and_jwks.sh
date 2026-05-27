#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Uso: $0 <issuer> <subject> <audience> [key_dir]"
  exit 1
fi

ISSUER="$1"
SUBJECT="$2"
AUDIENCE="$3"
KEY_DIR="${4:-./keys}"
TTL_SECONDS="${TTL_SECONDS:-300}"

if ! [[ "$TTL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "[ERROR] TTL_SECONDS must be an integer number of seconds."
  exit 1
fi

if [ "$TTL_SECONDS" -le 0 ] || [ "$TTL_SECONDS" -gt 300 ]; then
  echo "[ERROR] TTL_SECONDS must be between 1 and 300 seconds."
  exit 1
fi

mkdir -p "$KEY_DIR"
PRIVATE_KEY="$KEY_DIR/private.pem"
PUBLIC_KEY="$KEY_DIR/public.pem"
JWT_FILE="$KEY_DIR/token.jwt"
JWKS_FILE="$KEY_DIR/jwks.json"

b64url() {
  openssl base64 -e -A | tr '+/' '-_' | tr -d '='
}

derive_kid() {
  openssl pkey -pubin -in "$PUBLIC_KEY" -outform DER 2>/dev/null \
    | openssl dgst -sha256 -binary \
    | xxd -p -c 64
}

if [ ! -f "$PRIVATE_KEY" ]; then
  echo "[INFO] Private key not found. Generating new RSA key pair in $KEY_DIR"
  openssl genpkey -algorithm RSA -out "$PRIVATE_KEY" -pkeyopt rsa_keygen_bits:2048 >/dev/null 2>&1
  openssl rsa -pubout -in "$PRIVATE_KEY" -out "$PUBLIC_KEY" >/dev/null 2>&1
else
  echo "[INFO] Reusing existing private key: $PRIVATE_KEY"
  if [ ! -f "$PUBLIC_KEY" ]; then
    echo "[INFO] Public key not found. Extracting from private key."
    openssl rsa -pubout -in "$PRIVATE_KEY" -out "$PUBLIC_KEY" >/dev/null 2>&1
  fi
fi

if [ -z "${KID:-}" ]; then
  KID="kid-$(derive_kid)"
fi

NOW=$(date +%s)
EXP=$((NOW + TTL_SECONDS))
JTI=$(openssl rand -hex 16)

HEADER=$(printf '{"alg":"RS256","typ":"JWT","kid":"%s"}' "$KID")
PAYLOAD=$(printf '{"iss":"%s","sub":"%s","aud":"%s","iat":%s,"exp":%s,"jti":"%s"}' "$ISSUER" "$SUBJECT" "$AUDIENCE" "$NOW" "$EXP" "$JTI")

HEADER_B64=$(printf '%s' "$HEADER" | b64url)
PAYLOAD_B64=$(printf '%s' "$PAYLOAD" | b64url)
UNSIGNED_TOKEN="$HEADER_B64.$PAYLOAD_B64"

SIGNATURE_B64=$(printf '%s' "$UNSIGNED_TOKEN" \
  | openssl dgst -sha256 -sign "$PRIVATE_KEY" \
  | b64url)

JWT="$UNSIGNED_TOKEN.$SIGNATURE_B64"
printf '%s\n' "$JWT" > "$JWT_FILE"

MODULUS_B64=$(openssl rsa -pubin -in "$PUBLIC_KEY" -modulus -noout 2>/dev/null | cut -d= -f2 | xxd -r -p | b64url)
EXPONENT_B64="AQAB"

cat > "$JWKS_FILE" <<JSON
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "$KID",
      "n": "$MODULUS_B64",
      "e": "$EXPONENT_B64"
    }
  ]
}
JSON

echo "[INFO] JWT and JWKS generated successfully"
echo "[INFO] Private key: $PRIVATE_KEY"
echo "[INFO] Public key : $PUBLIC_KEY"
echo "[INFO] JWT file   : $JWT_FILE"
echo "[INFO] JWKS file  : $JWKS_FILE"
echo
echo "$JWT"
