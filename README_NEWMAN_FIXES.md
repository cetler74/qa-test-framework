# Quick Reference: Newman Test Failures

## TL;DR - The Problem

Tests **pass in Postman** but **fail in Newman** because:
- Newman's delay implementation runs each request in a **separate process**
- Variables from one request don't carry to the next
- Tests that depend on auth tokens, session data, or IDs from previous requests fail

---

## TL;DR - The Solution

**Immediate Fix** (do this first):
1. Don't use `delayBetweenTests` (or set to 0)
2. Pass environment variables when calling tests:
   ```javascript
   {
     envVars: {
       base_url: "https://api.example.com",
       access_token: "Bearer token...",
       // Add other variables your collection needs
     }
   }
   ```

**Proper Fix** (optional, better):
- Replace sequential process loop with Newman's `delayRequest` option
- See CODE_CHANGES_DELAY_FIX.md

---

## Symptoms You're Seeing

- ❌ Test 1 passes, Tests 2+ fail
- ❌ "undefined variable" errors
- ❌ 401/403 auth errors
- ❌ 400/404 "resource not found" errors
- ❌ Works fine in Postman but fails in Newman

---

## Root Causes in Your Code

| Location | Issue |
|----------|-------|
| `services/testRunner.js` lines 537-573 | Each test runs in separate Newman process when delays enabled |
| `services/testRunner.js` lines 63-73 | Variable conflicts when merging collections |
| `services/testRunner.js` lines 46-50 | Item names change during merging |

---

## Files Created to Help You

1. **SUMMARY.md** ← START HERE
   - High-level overview of the problem

2. **QUICK_FIXES.md** ← DO THIS NEXT
   - Immediate fixes (disable delays, add envVars)
   - Diagnostic checklist

3. **VISUAL_DIAGNOSIS.md**
   - Visual comparison of execution flows
   - Shows exactly why tests fail

4. **CODE_CHANGES_DELAY_FIX.md**
   - Exact code changes for proper fix
   - Only needed if you want delays to work

5. **NEWMAN_TROUBLESHOOTING.md**
   - Deep technical analysis
   - All problem details explained

---

## Action Items (In Order)

- [ ] Read SUMMARY.md
- [ ] Read QUICK_FIXES.md
- [ ] Check your Postman collection Variables
- [ ] Disable `delayBetweenTests` (set to 0 or omit)
- [ ] Pass `envVars` when calling test execution
- [ ] Test → Should now pass ✅
- [ ] If working, optionally read CODE_CHANGES_DELAY_FIX.md
- [ ] If working, optionally implement proper delay fix

---

## Common Variables to Pass

```javascript
{
  envVars: {
    base_url: "https://api.example.com",
    access_token: "Bearer YOUR_TOKEN",
    environment: "test",
    x_correlator: "unique-id",
    tenant_id: "123",
    phone_number: "+1234567890"
  }
}
```

Check your Postman collection Variables tab for the exact names.

---

## Key Insight

**Postman**: One browser session → all requests in one context → variables persist

**Newman (Current)**: Each request in separate CLI process → no shared context → variables lost

**Newman (Fixed)**: All requests in one CLI process → variables persist

---

## Contact/Questions

If you get stuck:
1. Check VISUAL_DIAGNOSIS.md to understand the flow
2. Check QUICK_FIXES.md for diagnostic steps
3. Verify variables are being passed
4. Try with `delayBetweenTests: 0` first
5. Then implement proper fix if needed

---

## References

- **Newman Documentation**: https://github.com/postmanlabs/newman
- **Postman Learning Center**: https://learning.postman.com
- **Your Collection**: `SmartAPI-CAMARA R2.0.0 - Tests.postman_collection.json`

