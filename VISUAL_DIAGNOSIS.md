# Visual Diagnosis: Postman vs Newman Execution Flow

## Execution Model Comparison

### How Postman Runs Your Tests
```
┌─────────────────────────────────────────────────────────┐
│                  POSTMAN SINGLE CONTEXT                 │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Memory/Context Shared Across ALL Requests:             │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Variables: {                                     │   │
│  │   base_url: "https://api.example.com"           │   │
│  │   access_token: undefined (initially)           │   │
│  │   user_id: undefined (initially)                │   │
│  │   resource_id: undefined (initially)            │   │
│  │ }                                                │   │
│  └──────────────────────────────────────────────────┘   │
│                                                           │
│  ┌─ Request 1: Login ──────────────────────────────┐    │
│  │ POST /auth/login                                │    │
│  │ Response: { token: "abc123", user_id: "99" }   │    │
│  │ Test Script: pm.environment.set("access_token",│    │
│  │              pm.response.json().token)          │    │
│  │ ✅ Variables updated:                           │    │
│  │    access_token: "abc123"                       │    │
│  │    user_id: "99"                                │    │
│  └─────────────────────────────────────────────────┘    │
│                          ↓                               │
│  ┌─ Request 2: Get Protected Resource ────────────┐    │
│  │ GET /api/users/{{user_id}}                      │    │
│  │ Headers: Authorization: {{access_token}}        │    │
│  │ ✅ Variables AVAILABLE (from Request 1):       │    │
│  │    user_id = "99"                              │    │
│  │    access_token = "abc123"                      │    │
│  │ Response: { resource: "data", id: "123" }       │    │
│  │ ✅ PASSES because headers are populated        │    │
│  └─────────────────────────────────────────────────┘    │
│                          ↓                               │
│  ┌─ Request 3: Delete Resource ───────────────────┐    │
│  │ DELETE /api/resources/123                       │    │
│  │ Headers: Authorization: {{access_token}}        │    │
│  │ ✅ Variables STILL AVAILABLE:                   │    │
│  │    access_token = "abc123" (from Request 1)    │    │
│  │ Response: { success: true }                      │    │
│  │ ✅ PASSES                                       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  Result: ✅ ALL TESTS PASS                              │
└─────────────────────────────────────────────────────────┘
```

---

### How Newman Currently Runs Your Tests (WITH DELAYS)
```
┌──────────────────────────────────────────────────────────┐
│               NEWMAN SEPARATE PROCESSES                   │
│         (When delayBetweenTests is enabled)              │
├──────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────────────────────────────────────────────┐     │
│  │           PROCESS 1: Request 1 (Login)         │     │
│  │                                                  │     │
│  │  Variables (Process 1 only):                   │     │
│  │  ┌────────────────────────────────────────┐    │     │
│  │  │ access_token: undefined                │    │     │
│  │  │ user_id: undefined                     │    │     │
│  │  └────────────────────────────────────────┘    │     │
│  │                                                  │     │
│  │  Request: POST /auth/login                      │     │
│  │  Response: { token: "abc123", user_id: "99" }  │     │
│  │  Test Script: pm.environment.set(...)           │     │
│  │  → Sets access_token: "abc123" in Process 1     │     │
│  │  ✅ PASSES in Process 1                         │     │
│  │                                                  │     │
│  │  Process 1 TERMINATES ✓                         │     │
│  │  Variables in Process 1 DESTROYED ✗             │     │
│  └─────────────────────────────────────────────────┘     │
│              ⏰ Wait 2 seconds (delay)                   │
│  ┌─────────────────────────────────────────────────┐     │
│  │      PROCESS 2: Request 2 (Get Protected)      │     │
│  │         (COMPLETELY NEW PROCESS)               │     │
│  │                                                  │     │
│  │  Variables (Process 2 only):                   │     │
│  │  ┌────────────────────────────────────────┐    │     │
│  │  │ access_token: undefined ✗ LOST!       │    │     │
│  │  │ user_id: undefined ✗ LOST!            │    │     │
│  │  └────────────────────────────────────────┘    │     │
│  │                                                  │     │
│  │  Request: GET /api/users/{{user_id}}           │     │
│  │  Headers: Authorization: {{access_token}}      │     │
│  │  Problem:                                        │     │
│  │    - user_id resolves to: undefined ✗          │     │
│  │    - access_token resolves to: undefined ✗     │     │
│  │                                                  │     │
│  │  Result: GET /api/users/undefined               │     │
│  │  Response: 400 Bad Request / 404 Not Found      │     │
│  │  ✗ FAILS with "undefined variable" error       │     │
│  └─────────────────────────────────────────────────┘     │
│              ⏰ Wait 2 seconds (delay)                   │
│  ┌─────────────────────────────────────────────────┐     │
│  │      PROCESS 3: Request 3 (Delete)             │     │
│  │         (ANOTHER NEW PROCESS)                  │     │
│  │                                                  │     │
│  │  Variables (Process 3 only):                   │     │
│  │  ┌────────────────────────────────────────┐    │     │
│  │  │ access_token: undefined ✗ LOST!       │    │     │
│  │  └────────────────────────────────────────┘    │     │
│  │                                                  │     │
│  │  Request: DELETE /api/resources/123             │     │
│  │  Headers: Authorization: {{access_token}}      │     │
│  │  Problem: access_token is undefined ✗          │     │
│  │                                                  │     │
│  │  Response: 401 Unauthorized                     │     │
│  │  ✗ FAILS with auth error                       │     │
│  └─────────────────────────────────────────────────┘     │
│                                                            │
│  Result: ❌ TEST 1 PASSES, TESTS 2-3 FAIL               │
└──────────────────────────────────────────────────────────┘
```

---

### How Newman SHOULD Run Your Tests (FIXED)
```
┌──────────────────────────────────────────────────────────┐
│            NEWMAN SINGLE PROCESS (FIXED)                 │
│        With Newman's built-in delayRequest               │
├──────────────────────────────────────────────────────────┤
│                                                            │
│  Memory/Context Shared Across ALL Requests:             │
│  ┌────────────────────────────────────────────────┐      │
│  │ Variables: {                                   │      │
│  │   base_url: "https://api.example.com"         │      │
│  │   access_token: undefined (initially)         │      │
│  │   user_id: undefined (initially)              │      │
│  │ }                                              │      │
│  └────────────────────────────────────────────────┘      │
│                                                            │
│  ┌─ Request 1: Login ─────────────────────────────┐      │
│  │ POST /auth/login                               │      │
│  │ Response: { token: "abc123", user_id: "99" }  │      │
│  │ Test Script: pm.environment.set(...)           │      │
│  │ ✅ Variables updated in THIS process:         │      │
│  │    access_token: "abc123"                      │      │
│  │    user_id: "99"                               │      │
│  │ ✅ PASSES                                      │      │
│  └────────────────────────────────────────────────┘      │
│              ⏰ Wait 2 seconds (delayRequest)            │
│  ┌─ Request 2: Get Protected Resource ────────────┐      │
│  │ GET /api/users/{{user_id}}                     │      │
│  │ Headers: Authorization: {{access_token}}       │      │
│  │ ✅ Variables AVAILABLE in SAME process:       │      │
│  │    user_id = "99" (from Request 1)            │      │
│  │    access_token = "abc123" (from Request 1)   │      │
│  │ Request: GET /api/users/99                     │      │
│  │ Response: { resource: "data", id: "123" }      │      │
│  │ ✅ PASSES                                      │      │
│  └────────────────────────────────────────────────┘      │
│              ⏰ Wait 2 seconds (delayRequest)            │
│  ┌─ Request 3: Delete Resource ──────────────────┐      │
│  │ DELETE /api/resources/123                      │      │
│  │ Headers: Authorization: {{access_token}}       │      │
│  │ ✅ Variables STILL AVAILABLE in SAME process: │      │
│  │    access_token = "abc123" (from Request 1)   │      │
│  │ Response: { success: true }                     │      │
│  │ ✅ PASSES                                      │      │
│  └────────────────────────────────────────────────┘      │
│                                                            │
│  Result: ✅ ALL TESTS PASS                               │
└──────────────────────────────────────────────────────────┘
```

---

## Error Comparison

### Errors You're Probably Seeing (Current)

**Test 1: Login** ✅
```
Status: 200 OK
Assertions: ✅ PASS
Response: {
  "token": "abc123",
  "user_id": "99"
}
```

**Test 2: Get Protected** ❌
```
Status: 400 Bad Request (or 404/undefined)
Assertions: ❌ FAIL
Error: "undefined variable" OR "Cannot find user undefined"
Request sent to: GET /api/users/undefined
Headers: Authorization: undefined
Reason: access_token and user_id lost between processes
```

**Test 3: Delete** ❌
```
Status: 401 Unauthorized
Assertions: ❌ FAIL
Error: "Missing or invalid Authorization header"
Reason: access_token lost between processes
```

---

## Variable Tracking Through Requests

### Current Behavior (Broken)
```
Request 1 (Process 1):
  access_token = undefined
  pm.environment.set("access_token", "abc123") 
  ✅ Set successfully
  Process 1 ends → access_token destroyed

Request 2 (Process 2):  
  access_token = undefined ❌ LOST
  → Request fails

Request 3 (Process 3):
  access_token = undefined ❌ LOST
  → Request fails
```

### Fixed Behavior
```
Request 1 (Process 1):
  access_token = undefined
  pm.environment.set("access_token", "abc123")
  ✅ Set successfully
  Process continues

Request 2 (same Process 1):
  access_token = "abc123" ✅ AVAILABLE
  → Request succeeds
  Process continues

Request 3 (same Process 1):
  access_token = "abc123" ✅ AVAILABLE
  → Request succeeds
```

---

## Why This Matters

| Scenario | Postman | Newman (Current) | Newman (Fixed) |
|----------|---------|------------------|----------------|
| Sequential auth flow | ✅ | ❌ | ✅ |
| Computed values (IDs) | ✅ | ❌ | ✅ |
| Session persistence | ✅ | ❌ | ✅ |
| With delays enabled | ✅ | ❌ | ✅ |
| Without delays | ✅ | ✅ | ✅ |

---

## The One-Line Fix Explanation

**Change this:**
```javascript
// Newman calls: Process 1, Process 2, Process 3 (separate) ✗
```

**To this:**
```javascript
// Newman calls: Process 1 with 2-second delay, then continues ✓
```

**Code:**
```javascript
// Before (broken):
// for (let i = 0; i < items.length; i++) {
//   await runNewmanTests(singleCollection); // Each is new process
//   await sleep(2000);
// }

// After (fixed):
const newmanOptions = { 
  delayRequest: 2000  // Newman delays between items in SAME process
};
```

