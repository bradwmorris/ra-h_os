# Troubleshooting

## Installation Issues

### `npm install` fails

**Symptom:** Error during native module compilation

**Fix:** Install build tools:
```bash
# macOS
xcode-select --install

# Linux
sudo apt install build-essential python3

# Windows
npm install -g windows-build-tools
```

### `npm run setup:local` fails

**Symptom:** Native module rebuild errors

**Fix:**
1. Ensure Node.js 22+ is installed
2. Delete `node_modules` and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm run setup:local
   ```

## Runtime Issues

### App won't start

**Symptom:** Error on `npm run dev`

**Fixes:**
1. Run local setup first: `npm run setup:local`
2. Check `.env.local` exists (copy from `.env.example` if missing)
3. Ensure database directory exists: `~/Library/Application Support/RA-H/db/`

### Vector search returns no results

**Symptom:** Semantic search doesn't find matches

**Fixes:**
1. Ensure `sqlite-vec` extension is loading (check console for errors)
2. Verify `SQLITE_VEC_EXTENSION_PATH` in `.env.local` points to `vendor/sqlite-extensions/vec0.dylib`
3. Note: sqlite-vec only works on macOS currently. Linux/Windows users need to compile it manually.

### API key validation fails

**Symptom:** "Invalid key" error in Settings

**Fixes:**
1. Verify key format:
   - OpenAI: starts with `sk-`
   - Anthropic: starts with `sk-ant-`
2. Check key has correct permissions/credits
3. Try regenerating the key in provider dashboard

### Chat returns errors

**Symptom:** Error messages when chatting

**Fixes:**
1. Check API keys are valid (Settings → API Keys)
2. Verify internet connection
3. Check browser console for specific error messages

## Database Issues

### Database locked

**Symptom:** "SQLITE_BUSY" errors

**Fix:** Only run one instance of RA-H at a time. Close any other terminals running the app.

### Missing tables

**Symptom:** "no such table" errors

**Fix:** Re-run the schema script:
```bash
scripts/database/sqlite-ensure-app-schema.sh ~/Library/Application\ Support/RA-H/db/rah.sqlite
```

## Platform-Specific

### Linux/Windows

The bundled `vec0.dylib` and `yt-dlp` binaries are macOS-only. For other platforms:

1. **sqlite-vec**: Build from source at https://github.com/asg017/sqlite-vec
2. **yt-dlp**: Download from https://github.com/yt-dlp/yt-dlp/releases

See the main README for detailed instructions.
