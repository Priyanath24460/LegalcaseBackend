# Gemini API Key Rotation System

## Overview
This system automatically rotates between 3 Gemini API keys when one hits its rate limit (429 error). If a key exceeds quota, the system will:
1. Detect the rate limit error (HTTP 429)
2. Mark that key for cooldown (60 minutes by default)
3. Switch to the next available key
4. Retry the request automatically

## Setup

### 1. Add Your API Keys to `.env`
Edit `LegalcaseBackend/.env` and add your Gemini API keys:

```env
# Gemini API Keys (Rotate between multiple keys on rate limit)
GEMINI_API_KEY_1=your_first_api_key_here
GEMINI_API_KEY_2=your_second_api_key_here
GEMINI_API_KEY_3=your_third_api_key_here
```

You can add 1-3 keys. The system only uses keys that are configured (not empty).

### 2. Configuration
- **Cooldown Period**: 60 minutes (can be adjusted in `geminiService.js`)
- **Max Retries**: Equal to number of configured keys
- **Rotation**: Automatic after rate limit detection

## How It Works

### Key Rotation States

```
Available Key → Request Made → ✅ Success (Continue)
                             ↓
                          ❌ Rate Limit (429)
                             ↓
                    Mark for Cooldown (60 min)
                             ↓
                    Rotate to Next Key
                             ↓
                    Retry Request
```

### Logging
Watch for these log messages:

- `[Gemini] Using API key 1/3` → Current key in use
- `[Gemini] 🔴 Rate limit hit on key 1` → Key hit quota limit
- `[Gemini] Key 1 is in cooldown, trying next...` → Waiting before retry
- `[Gemini] Rotated to key 2/3` → Switched to next key
- `[Gemini] All API keys are in cooldown` → All keys exhausted

## Monitoring

To monitor key usage, check the Node.js server logs for:

```
[Gemini] Using API key 2/3
[Gemini] Full API response: {...}
```

To see when rate limits are hit:

```
[Gemini] 🔴 Rate limit hit on key 1. Error: {message: "Resource has been exhausted..."}
[Gemini] Retrying with next API key...
```

## Cooldown Management

### Current Behavior
- When key hits rate limit: **60-minute cooldown** (adjustable)
- After cooldown expires: Key becomes available again
- Cooldown timestamp tracked per key

### Customizing Cooldown
Edit `geminiService.js` function `isKeyInCooldown()`:
```javascript
const isKeyInCooldown = (keyIndex, cooldownMinutes = 60) => {
  // Change 60 to your desired cooldown in minutes
```

## Quota Tips

To maximize usage across keys:

1. **Spread Requests**: Distribute requests across multiple API keys
2. **Monitor Daily Quotas**: ~15,000 requests per key per day (typical)
3. **Add More Keys**: If all keys exhaust, create additional API projects in Google Cloud
4. **Gentle Retry**: The system auto-handles retries, no need to manually retry failed requests

## Troubleshooting

### "All API keys are rate limited"
- **Cause**: All 3 keys hit their quota limits within the same hour
- **Solution**: 
  1. Wait 60+ minutes for cooldown to expire
  2. Check Google Cloud Console for actual quota limits
  3. Create additional API keys if frequently hit

### Missing API Key Errors
```
[Gemini] No API keys configured
```
- **Cause**: `.env` file doesn't have GEMINI_API_KEY_1, KEY_2, or KEY_3
- **Solution**: Add keys to `.env` and restart the server

### Partial Keys Configured
```
[Gemini] Using API key 1/2
```
- **Info**: System detected only 2 configured keys (KEY_1 and KEY_2)
- **OK**: System will rotate between the 2 available keys

## API Key Best Practices

1. **Security**:
   - Never commit `.env` with actual keys to git
   - Add `.env` to `.gitignore` ✅

2. **Quota Management**:
   - Check quota dashboard in Google Cloud Console
   - Consider quota increase requests if needed
   - Track daily usage patterns

3. **Rotation Strategy**:
   - Stagger key creation dates for quota reset
   - Use different Google Cloud projects if possible
   - Monitor costs per key

## Files Modified

- **`.env`** - Added GEMINI_API_KEY_1, KEY_2, KEY_3
- **`config.js`** - Now loads array of keys instead of single key
- **`services/geminiService.js`** - Added rotation logic with 429 error handling

## Function Reference

### `getNextApiKey()`
Returns the next available API key, skipping keys in cooldown.

### `markKeyAsRateLimited(keyIndex)`
Marks a key with timestamp when rate limit is hit.

### `rotateKey()`
Moves to the next key in the rotation (circular).

### `isKeyInCooldown(keyIndex, cooldownMinutes)`
Checks if a key is still waiting out its cooldown period.

### `callGeminiAPI(promptText, retryCount)`
Main API call function with automatic retry logic.

## Future Enhancements

Potential improvements:
- [ ] Persist key state to database (survive server restarts)
- [ ] Weighted key rotation based on quota remaining
- [ ] Admin dashboard to view key status
- [ ] Historical usage tracking per key
- [ ] Automatic API key validation on startup
