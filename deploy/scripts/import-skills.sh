#!/usr/bin/env bash
# Import skills from vm-agent/skills/ into PostgreSQL skill_files table.
# Usage: ./deploy/scripts/import-skills.sh [skills_dir] [db_url]
#
# Defaults:
#   skills_dir = vm-agent/skills
#   db_url = postgresql://postgres:jacoworks-jingao-2026@127.0.0.1:5432/jacoworks

set -euo pipefail

SKILLS_DIR="${1:-vm-agent/skills}"
DB_URL="${2:-postgresql://postgres:jacoworks-jingao-2026@127.0.0.1:5432/jacoworks}"

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "❌ Skills directory not found: $SKILLS_DIR"
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "❌ psql not found"
  exit 1
fi

echo "📦 Importing skills from: $SKILLS_DIR"

count=0
failed=0

# Find all files (not just .md — includes .json, .sh, .py, .txt etc.)
while IFS= read -r -d '' filepath; do
  # Get relative path from skills dir
  rel_path="${filepath#"$SKILLS_DIR"/}"

  # Read content
  content=$(cat "$filepath")

  # SHA-256 first 16 hex chars (matching Go's store.ContentChecksum)
  checksum=$(printf '%s' "$content" | shasum -a 256 | cut -c1-16)

  # Upsert into DB (escape single quotes by doubling them)
  escaped_content=$(printf '%s' "$content" | sed "s/'/''/g")
  escaped_path=$(printf '%s' "$rel_path" | sed "s/'/''/g")

  psql "$DB_URL" -q -c "
    INSERT INTO skill_files (owner, file_path, content, checksum)
    VALUES ('system', '${escaped_path}', '${escaped_content}', '${checksum}')
    ON CONFLICT (owner, file_path)
    DO UPDATE SET content = EXCLUDED.content, checksum = EXCLUDED.checksum, updated_at = now()
  " 2>/dev/null && ((count++)) || ((failed++))

done < <(find "$SKILLS_DIR" -type f -print0 | sort -z)

echo "✅ Imported: $count files, Failed: $failed"
echo "💡 Verify: psql \"$DB_URL\" -c \"SELECT COUNT(*) FROM skill_files WHERE owner='system';\""
