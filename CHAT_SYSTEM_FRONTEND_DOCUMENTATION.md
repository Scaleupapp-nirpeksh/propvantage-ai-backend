# Chat & Messaging System — Frontend Developer Documentation

> **Version**: 1.0.0
> **Base URL**: `http://localhost:3000` (or your deployment URL)
> **Protocol**: REST API + Socket.IO (WebSocket)
> **Authentication**: JWT Bearer Token (both REST and Socket.IO)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Authentication](#2-authentication)
3. [Socket.IO Setup & Real-Time Events](#3-socketio-setup--real-time-events)
4. [Data Models & TypeScript Interfaces](#4-data-models--typescript-interfaces)
5. [REST API Reference — Conversations](#5-rest-api-reference--conversations)
6. [REST API Reference — Messages](#6-rest-api-reference--messages)
7. [REST API Reference — Entity Conversations](#7-rest-api-reference--entity-conversations)
8. [REST API Reference — Search & Presence](#8-rest-api-reference--search--presence)
9. [Permissions & Role-Based UI Gating](#9-permissions--role-based-ui-gating)
10. [Conversation Types & UI Behavior](#10-conversation-types--ui-behavior)
11. [Message Types & Rendering Guide](#11-message-types--rendering-guide)
12. [Features Implementation Guide](#12-features-implementation-guide)
13. [Pagination Patterns](#13-pagination-patterns)
14. [State Management Recommendations](#14-state-management-recommendations)
15. [Error Handling](#15-error-handling)
16. [Demo Data & Testing](#16-demo-data--testing)
17. [UI Component Hierarchy](#17-ui-component-hierarchy)

---

## 1. System Overview

The chat system provides three types of conversations:

| Type | Description | Created By |
|------|-------------|------------|
| **direct** | 1-on-1 between two users | `POST /api/chat/conversations` or automatic dedup |
| **group** | Multiple users, named groups | `POST /api/chat/conversations` (needs `chat:create_group`) |
| **entity** | Linked to a CRM entity (Lead, Sale, Project, etc.) | Auto-created via `GET /api/chat/entity/:entityType/:entityId` |

### Architecture

```
┌──────────────────────────┐        ┌──────────────────────────┐
│      Frontend (React)     │        │         Backend           │
│                          │        │                          │
│  REST API ───────────────────────→│ Express Controllers      │
│  (send msg, create conv) │        │ (persist in MongoDB)     │
│                          │        │                          │
│  Socket.IO ←─────────────────────→│ Socket.IO Server         │
│  (real-time events)      │        │ (broadcasts to rooms)    │
└──────────────────────────┘        └──────────────────────────┘
```

**Key principle**: Messages are **sent via REST** (to guarantee persistence), then **broadcast via Socket.IO** for real-time delivery.

---

## 2. Authentication

### REST API

All endpoints require the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

The JWT is obtained from `POST /api/auth/login`:

```json
// POST /api/auth/login
{
  "email": "rajesh.kapoor@prestige.com",
  "password": "Demo@1234"
}

// Response
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "_id": "...",
      "firstName": "Rajesh",
      "lastName": "Kapoor",
      "email": "rajesh.kapoor@prestige.com",
      "role": { ... },
      "permissions": ["chat:view", "chat:send", "chat:create_group", ...]
    }
  }
}
```

### Socket.IO

Pass the JWT in the `auth` object when connecting:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: '<jwt_token>',  // Same JWT used for REST
  },
  // Alternative: pass as header
  // extraHeaders: { Authorization: 'Bearer <jwt_token>' }
});
```

If authentication fails, the Socket.IO server emits a `connect_error`:

```javascript
socket.on('connect_error', (err) => {
  console.error('Socket auth failed:', err.message);
  // err.message will be one of:
  // - "Authentication error: No token provided"
  // - "Authentication error: User not found or inactive"
  // - "Authentication error: Invalid token"
});
```

---

## 3. Socket.IO Setup & Real-Time Events

### 3.1 Connection & Auto-Join

When a socket connects, the server automatically:
1. Tracks the user as **online**
2. Joins them to the **org room** (`org:{orgId}`)
3. Joins them to **all their active conversation rooms** (`conversation:{convId}`)
4. Broadcasts `user:online` to the organization

Multi-tab support: Each user can have multiple socket connections (one per tab/device). The user is only marked offline when **all** sockets disconnect.

### 3.2 Client → Server Events

| Event | Payload | Purpose | When to Emit |
|-------|---------|---------|--------------|
| `conversation:join` | `{ conversationId: string }` | Join a conversation room | When opening a conversation that was created after connection |
| `conversation:leave` | `{ conversationId: string }` | Leave a conversation room | When user leaves a conversation or on cleanup |
| `conversation:read` | `{ conversationId: string }` | Mark as read via socket (with acknowledgment) | When user opens/views a conversation |
| `typing:start` | `{ conversationId: string }` | Start typing indicator | When user starts typing in the input |
| `typing:stop` | `{ conversationId: string }` | Stop typing indicator | When user stops typing (debounce ~2s) or clears input |

#### conversation:read with Acknowledgment

```javascript
socket.emit('conversation:read', { conversationId: '...' }, (response) => {
  if (response.success) {
    // Update local unread count to 0
  } else {
    console.error('Read failed:', response.error);
  }
});
```

### 3.3 Server → Client Events

#### Message Events

| Event | Payload | Trigger |
|-------|---------|---------|
| `message:new` | `{ conversationId, message }` | New message sent (via REST) |
| `message:edited` | `{ conversationId, messageId, text, isEdited, editedAt }` | Message edited |
| `message:deleted` | `{ conversationId, messageId }` | Message soft-deleted |
| `message:reaction` | `{ conversationId, messageId, userId, emoji, action, reactions }` | Reaction toggled |
| `message:pinned` | `{ conversationId, messageId, isPinned, pinnedBy }` | Pin toggled |

#### Conversation Events

| Event | Payload | Trigger |
|-------|---------|---------|
| `conversation:updated` | `{ conversationId, changes }` | Conversation metadata changed (name, description, participants) |
| `conversation:read` | `{ conversationId, userId, timestamp }` | User read the conversation (read receipt) |

#### Typing Events

| Event | Payload | Trigger |
|-------|---------|---------|
| `typing:start` | `{ conversationId, userId, userName }` | Another user started typing |
| `typing:stop` | `{ conversationId, userId }` | Another user stopped typing |

#### Presence Events

| Event | Payload | Trigger |
|-------|---------|---------|
| `user:online` | `{ userId }` | User connected (new) |
| `user:offline` | `{ userId }` | User fully disconnected (all tabs closed) |

### 3.4 Complete Socket.IO Client Setup Example

```javascript
import { io } from 'socket.io-client';

class ChatSocket {
  constructor(token) {
    this.socket = io('http://localhost:3000', {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.setupListeners();
  }

  setupListeners() {
    // Connection
    this.socket.on('connect', () => {
      console.log('Connected to chat server');
    });

    this.socket.on('connect_error', (err) => {
      console.error('Connection error:', err.message);
    });

    // Messages
    this.socket.on('message:new', ({ conversationId, message }) => {
      // Add message to conversation's message list
      // Update conversation's lastMessage in sidebar
      // Increment unread count if conversation is not currently open
    });

    this.socket.on('message:edited', ({ conversationId, messageId, text, isEdited, editedAt }) => {
      // Update message text in the UI
      // Show "(edited)" indicator
    });

    this.socket.on('message:deleted', ({ conversationId, messageId }) => {
      // Replace message content with "This message was deleted" placeholder
    });

    this.socket.on('message:reaction', ({ conversationId, messageId, userId, emoji, action, reactions }) => {
      // Update reactions array on the message
    });

    this.socket.on('message:pinned', ({ conversationId, messageId, isPinned, pinnedBy }) => {
      // Update pin status on the message
      // Show/hide pin indicator
    });

    // Conversation updates
    this.socket.on('conversation:updated', ({ conversationId, changes }) => {
      // Update conversation metadata (name, participants list, etc.)
    });

    this.socket.on('conversation:read', ({ conversationId, userId, timestamp }) => {
      // Update read receipt indicators (e.g., double checkmarks)
    });

    // Typing indicators
    this.socket.on('typing:start', ({ conversationId, userId, userName }) => {
      // Show "userName is typing..." in conversation
    });

    this.socket.on('typing:stop', ({ conversationId, userId }) => {
      // Remove typing indicator for this user
    });

    // Presence
    this.socket.on('user:online', ({ userId }) => {
      // Update user's online status dot to green
    });

    this.socket.on('user:offline', ({ userId }) => {
      // Update user's online status dot to grey
    });
  }

  // Helper methods
  joinConversation(conversationId) {
    this.socket.emit('conversation:join', { conversationId });
  }

  leaveConversation(conversationId) {
    this.socket.emit('conversation:leave', { conversationId });
  }

  markAsRead(conversationId) {
    this.socket.emit('conversation:read', { conversationId }, (response) => {
      return response;
    });
  }

  startTyping(conversationId) {
    this.socket.emit('typing:start', { conversationId });
  }

  stopTyping(conversationId) {
    this.socket.emit('typing:stop', { conversationId });
  }

  disconnect() {
    this.socket.disconnect();
  }
}
```

### 3.5 Typing Indicator Implementation

```javascript
// Recommended: Debounce typing events
let typingTimeout = null;
let isTyping = false;

function handleInputChange(conversationId, text) {
  if (text.length > 0 && !isTyping) {
    isTyping = true;
    chatSocket.startTyping(conversationId);
  }

  // Reset the stop timer
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    if (isTyping) {
      isTyping = false;
      chatSocket.stopTyping(conversationId);
    }
  }, 2000); // Stop after 2 seconds of no typing

  // Also stop when input is cleared
  if (text.length === 0 && isTyping) {
    isTyping = false;
    chatSocket.stopTyping(conversationId);
    clearTimeout(typingTimeout);
  }
}
```

---

## 4. Data Models & TypeScript Interfaces

### 4.1 Conversation Object

```typescript
interface Conversation {
  _id: string;
  organization: string;

  type: 'direct' | 'group' | 'entity';

  name?: string;          // Set for group & entity, null for direct
  description?: string;   // Set for group & entity

  entity?: {
    entityType: 'Lead' | 'Sale' | 'Project' | 'Invoice' | 'ConstructionMilestone' | 'PaymentTransaction';
    entityId: string;
    displayLabel: string;  // e.g., "Lead: Amit Kulkarni", "Project: Horizon Heights"
  };

  participants: Participant[];

  createdBy: {
    _id: string;
    firstName: string;
    lastName: string;
  };

  lastMessage?: {
    text: string;          // Preview text (max 100 chars)
    sender: {
      _id: string;
      firstName: string;
      lastName: string;
    };
    senderName: string;
    timestamp: string;     // ISO date string
    messageType: string;   // 'text' | 'file' | 'system' | 'entity_reference'
  };

  messageCount: number;
  isActive: boolean;
  isArchived: boolean;
  archivedBy?: string;
  archivedAt?: string;

  settings: {
    allowFileSharing: boolean;
    allowReactions: boolean;
  };

  // Enriched fields (added by getConversations)
  myUnreadCount: number;
  myLastReadAt: string;

  createdAt: string;
  updatedAt: string;
}

interface Participant {
  user: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    profileImage?: string;
  };
  role: 'admin' | 'member';
  joinedAt: string;
  lastReadAt: string;
  unreadCount: number;
  isActive: boolean;
  leftAt?: string;
  notifications: 'all' | 'mentions' | 'none';
}
```

### 4.2 Message Object

```typescript
interface Message {
  _id: string;
  organization: string;
  conversation: string;   // Conversation ID

  sender: {
    _id: string;
    firstName: string;
    lastName: string;
    profileImage?: string;
  } | null;               // null for system messages

  type: 'text' | 'file' | 'system' | 'entity_reference';

  content: {
    text?: string;        // Message text (max 5000 chars)
    systemEvent?: 'participant_added' | 'participant_removed' | 'conversation_created' | 'name_changed';
    systemData?: any;     // Varies by systemEvent (see section 11)
  };

  attachments: Attachment[];

  entityReference?: {
    entityType: 'Lead' | 'Sale' | 'Project' | 'Invoice' | 'ConstructionMilestone' | 'PaymentTransaction' | 'Task';
    entityId: string;
    displayLabel: string;
    metadata?: any;       // Denormalized entity info for rich card rendering
  };

  mentions: {
    _id: string;
    firstName: string;
    lastName: string;
  }[];

  replyTo?: {
    message: string;      // Original message ID
    text: string;         // Preview of original (max 200 chars)
    senderName: string;   // Original sender name
  };

  reactions: Reaction[];

  isPinned: boolean;
  pinnedBy?: {
    _id: string;
    firstName: string;
    lastName: string;
  };
  pinnedAt?: string;

  isEdited: boolean;
  editedAt?: string;

  isDeleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  _isDeletedPlaceholder?: boolean;  // Only present in GET responses for deleted messages

  forwardedFrom?: {
    conversation: string;    // Original conversation ID
    message: string;         // Original message ID
    senderName: string;      // Original sender name
  };

  readBy: {
    user: string;
    readAt: string;
  }[];

  createdAt: string;
  updatedAt: string;
}

interface Attachment {
  file?: string;          // File model ID (if uploaded via File system)
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
}

interface Reaction {
  emoji: string;          // e.g., "👍", "❤️", "😂"
  user: {
    _id: string;
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}
```

### 4.3 Pagination Objects

```typescript
// Used by getConversations (offset-based)
interface ConversationPagination {
  currentPage: number;
  totalPages: number;
  total: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// Used by getMessages (cursor-based)
interface MessagePaginationInfo {
  hasMore: boolean;       // true if more older messages exist
  oldestId: string | null;  // ID of oldest message in this batch (use as `before` cursor)
  newestId: string | null;  // ID of newest message in this batch
}
```

---

## 5. REST API Reference — Conversations

### 5.1 Create Conversation

**`POST /api/chat/conversations`**
Permission: `chat:send` (additionally `chat:create_group` for group type)

#### Direct Conversation

```json
// Request Body
{
  "type": "direct",
  "participantIds": ["<otherUserId>"]  // Exactly 1 user ID
}
```

If a direct conversation already exists between these two users, it returns the existing one (deduplication).

#### Group Conversation

```json
// Request Body
{
  "type": "group",
  "participantIds": ["<userId1>", "<userId2>", "<userId3>"],  // At least 1
  "name": "Sales Leadership",          // Optional, defaults to "New Group"
  "description": "Weekly sync group"    // Optional
}
```

The requesting user is automatically added as an **admin**. All other participants are added as **members**.

#### Response (both types)

```json
{
  "success": true,
  "data": {
    "conversation": {
      "_id": "683be6fa0d0e7d...",
      "type": "direct",
      "organization": "...",
      "participants": [
        {
          "user": {
            "_id": "...",
            "firstName": "Rajesh",
            "lastName": "Kapoor",
            "email": "rajesh.kapoor@prestige.com",
            "profileImage": null
          },
          "role": "member",
          "joinedAt": "2025-06-01T06:25:46.361Z",
          "lastReadAt": "2025-06-01T06:25:46.361Z",
          "unreadCount": 0,
          "isActive": true,
          "notifications": "all"
        },
        {
          "user": {
            "_id": "...",
            "firstName": "Ananya",
            "lastName": "Desai",
            "email": "ananya.desai@prestige.com",
            "profileImage": null
          },
          "role": "member",
          "joinedAt": "2025-06-01T06:25:46.361Z",
          "lastReadAt": "2025-06-01T06:25:46.361Z",
          "unreadCount": 0,
          "isActive": true,
          "notifications": "all"
        }
      ],
      "createdBy": {
        "_id": "...",
        "firstName": "Rajesh",
        "lastName": "Kapoor"
      },
      "messageCount": 0,
      "isActive": true,
      "isArchived": false,
      "settings": { "allowFileSharing": true, "allowReactions": true },
      "createdAt": "2025-06-01T06:25:46.362Z",
      "updatedAt": "2025-06-01T06:25:46.362Z"
    }
  }
}
```

### 5.2 List Conversations

**`GET /api/chat/conversations`**
Permission: `chat:view`

#### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Items per page (max 50) |
| `archived` | string | `"false"` | `"true"` to show archived |
| `type` | string | — | Filter: `"direct"`, `"group"`, or `"entity"` |

#### Response

```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "_id": "...",
        "type": "group",
        "name": "Sales Leadership",
        "participants": [ ... ],
        "lastMessage": {
          "text": "Let's aim for 30% growth this quarter",
          "sender": { "_id": "...", "firstName": "Rajesh", "lastName": "Kapoor" },
          "senderName": "Rajesh Kapoor",
          "timestamp": "2025-06-01T12:30:00.000Z",
          "messageType": "text"
        },
        "messageCount": 6,
        "myUnreadCount": 2,
        "myLastReadAt": "2025-06-01T10:00:00.000Z",
        ...
      },
      ...
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "total": 4,
      "limit": 20,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

**Important fields for UI:**
- `myUnreadCount` — show badge count on the conversation item
- `myLastReadAt` — determine which messages are "unread"
- `lastMessage.text` — preview text in sidebar
- `lastMessage.timestamp` — sort conversations by most recent
- `lastMessage.senderName` — show "Rajesh: Let's aim for..."

### 5.3 Get Conversation by ID

**`GET /api/chat/conversations/:id`**
Permission: `chat:view`

Returns the full conversation object with populated participants. Only accessible if the requesting user is an active participant.

```json
{
  "success": true,
  "data": {
    "conversation": { ... }
  }
}
```

### 5.4 Update Conversation

**`PUT /api/chat/conversations/:id`**
Permission: `chat:send` (must be admin for group conversations)

Cannot update `direct` conversations.

```json
// Request Body — all fields optional
{
  "name": "New Group Name",
  "description": "Updated description",
  "settings": {
    "allowFileSharing": false,
    "allowReactions": true
  }
}
```

Emits `conversation:updated` via Socket.IO to all participants.

### 5.5 Add Participants

**`POST /api/chat/conversations/:id/participants`**
Permission: `chat:send` (must be admin or have `chat:manage_groups`)

Cannot add participants to `direct` conversations.

```json
// Request Body
{
  "userIds": ["<userId1>", "<userId2>"]
}
```

Response includes the updated conversation with populated participants.

A `system` message is automatically created: "Rajesh Kapoor added 2 participant(s)".

### 5.6 Remove Participant

**`DELETE /api/chat/conversations/:id/participants/:userId`**
Permission: `chat:send` (admin, `chat:manage_groups`, or self-removal)

Cannot remove from `direct` conversations.

```json
{
  "success": true,
  "message": "Participant removed"
}
```

### 5.7 Mark as Read

**`PUT /api/chat/conversations/:id/read`**
Permission: `chat:view`

Resets the user's `unreadCount` to 0 and updates `lastReadAt`.

```json
{
  "success": true,
  "message": "Conversation marked as read"
}
```

**Note**: You can also mark as read via Socket.IO (`conversation:read` event) which additionally broadcasts a read receipt to other participants.

### 5.8 Archive / Unarchive Conversation

**`PUT /api/chat/conversations/:id/archive`**
Permission: `chat:view`

```json
// Request Body
{
  "archive": true    // or false to unarchive
}
```

Archived conversations are excluded from the default list. Use `?archived=true` query param to view them.

### 5.9 Leave Conversation

**`DELETE /api/chat/conversations/:id`**
Permission: `chat:view`

Cannot leave `direct` conversations. The user is marked as inactive with a `leftAt` timestamp. A system message is created.

```json
{
  "success": true,
  "message": "Left conversation"
}
```

---

## 6. REST API Reference — Messages

### 6.1 Send Message

**`POST /api/chat/conversations/:id/messages`**
Permission: `chat:send`

Must be an active participant of the conversation.

#### Text Message

```json
{
  "text": "Hello everyone! Let's discuss the new project timeline."
}
```

#### Text Message with Mentions

```json
{
  "text": "Hey @Ananya, can you check the leads report?",
  "mentions": ["<ananyaUserId>"]
}
```

#### Reply to Message

```json
{
  "text": "I agree with this approach",
  "replyTo": "<originalMessageId>"
}
```

The server automatically captures a preview of the original message (first 200 chars + sender name) and stores it in `replyTo`.

#### File Message

```json
{
  "attachments": [
    {
      "file": "<fileModelId>",
      "fileName": "proposal.pdf",
      "fileSize": 245760,
      "mimeType": "application/pdf",
      "url": "https://s3.../proposal.pdf"
    }
  ]
}
```

#### Text + File Message

```json
{
  "text": "Here's the updated proposal",
  "attachments": [
    {
      "fileName": "proposal_v2.pdf",
      "fileSize": 312450,
      "mimeType": "application/pdf",
      "url": "https://s3.../proposal_v2.pdf"
    }
  ]
}
```

#### Entity Reference Message

```json
{
  "entityReference": {
    "entityType": "Lead",
    "entityId": "<leadId>",
    "displayLabel": "Amit Kulkarni - 3BHK Inquiry",
    "metadata": {
      "budget": "1.5 Cr",
      "status": "Hot",
      "phone": "+91 98765 43210"
    }
  }
}
```

#### Response

```json
{
  "success": true,
  "data": {
    "message": {
      "_id": "683be7320d0e...",
      "conversation": "683be6fa0d0e...",
      "sender": {
        "_id": "...",
        "firstName": "Rajesh",
        "lastName": "Kapoor",
        "profileImage": null
      },
      "type": "text",
      "content": { "text": "Hello everyone!" },
      "attachments": [],
      "mentions": [],
      "reactions": [],
      "isPinned": false,
      "isEdited": false,
      "isDeleted": false,
      "readBy": [],
      "createdAt": "2025-06-01T06:26:10.123Z",
      "updatedAt": "2025-06-01T06:26:10.123Z"
    }
  }
}
```

**After sending**: The server automatically:
1. Updates the conversation's `lastMessage` (denormalized preview)
2. Increments `unreadCount` for all participants except the sender
3. Emits `message:new` to the conversation's Socket.IO room
4. Creates notifications for offline participants
5. Creates high-priority notifications for mentioned users

### 6.2 Get Messages (Cursor-Based Pagination)

**`GET /api/chat/conversations/:id/messages`**
Permission: `chat:view`

#### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Messages per page (max 100) |
| `before` | string | — | Message ID cursor — get messages **older** than this ID |
| `after` | string | — | Message ID cursor — get messages **newer** than this ID |

#### Usage Patterns

**Initial load (newest messages):**
```
GET /api/chat/conversations/:id/messages?limit=50
```

**Load older messages (scroll up):**
```
GET /api/chat/conversations/:id/messages?before=<oldestMessageId>&limit=50
```

**Load newer messages (catching up):**
```
GET /api/chat/conversations/:id/messages?after=<newestMessageId>&limit=50
```

#### Response

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "_id": "msg3",
        "type": "text",
        "content": { "text": "Latest message" },
        "sender": { "_id": "...", "firstName": "Rajesh", "lastName": "Kapoor", "profileImage": null },
        "createdAt": "2025-06-01T12:30:00.000Z",
        ...
      },
      {
        "_id": "msg2",
        "type": "text",
        "content": { "text": "Earlier message" },
        ...
      },
      {
        "_id": "msg1",
        "type": "system",
        "content": {
          "text": null,
          "systemEvent": "conversation_created",
          "systemData": {
            "createdBy": "...",
            "createdByName": "Rajesh Kapoor",
            "name": "Sales Leadership"
          }
        },
        "sender": null,
        ...
      }
    ],
    "hasMore": false,
    "oldestId": "msg1",
    "newestId": "msg3"
  }
}
```

**Messages are returned in reverse chronological order** (newest first). This matches the typical chat UI where the newest message is at the bottom — you'll need to reverse the array for rendering.

**Deleted messages** are returned as placeholders:
```json
{
  "_id": "...",
  "content": { "text": null },
  "attachments": [],
  "entityReference": null,
  "_isDeletedPlaceholder": true,
  "isDeleted": true,
  ...
}
```

### 6.3 Get Pinned Messages

**`GET /api/chat/conversations/:id/messages/pinned`**
Permission: `chat:view`

Returns up to 50 pinned messages, sorted by `pinnedAt` descending.

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "_id": "...",
        "content": { "text": "Important: Q3 targets confirmed" },
        "isPinned": true,
        "pinnedBy": { "_id": "...", "firstName": "Rajesh", "lastName": "Kapoor" },
        "pinnedAt": "2025-06-01T12:00:00.000Z",
        ...
      }
    ]
  }
}
```

### 6.4 Edit Message

**`PUT /api/chat/messages/:id`**
Permission: `chat:send` (own messages only)

```json
// Request Body
{
  "text": "Updated message text"
}
```

#### Response

```json
{
  "success": true,
  "message": "Message edited",
  "data": {
    "message": {
      "_id": "...",
      "content": { "text": "Updated message text" },
      "isEdited": true,
      "editedAt": "2025-06-01T12:35:00.000Z",
      ...
    }
  }
}
```

Emits `message:edited` via Socket.IO. Show "(edited)" label next to the message timestamp.

### 6.5 Delete Message (Soft Delete)

**`DELETE /api/chat/messages/:id`**
Permission: `chat:send`

**Authorization rules:**
- Own messages: always allowed
- Conversation admin: can delete any message in the conversation
- `chat:delete_any` permission: can delete any message (org-wide)

```json
{
  "success": true,
  "message": "Message deleted"
}
```

Emits `message:deleted` via Socket.IO. Show "This message was deleted" placeholder in the UI.

### 6.6 Toggle Reaction

**`POST /api/chat/messages/:id/reactions`**
Permission: `chat:view`

```json
// Request Body
{
  "emoji": "👍"
}
```

Toggle behavior: if the user has already reacted with this emoji, it removes the reaction. Otherwise, it adds it.

#### Response

```json
{
  "success": true,
  "data": {
    "action": "added",     // or "removed"
    "emoji": "👍",
    "reactions": [
      {
        "emoji": "👍",
        "user": { "_id": "...", "firstName": "Rajesh", "lastName": "Kapoor" },
        "createdAt": "2025-06-01T12:00:00.000Z"
      },
      {
        "emoji": "❤️",
        "user": { "_id": "...", "firstName": "Ananya", "lastName": "Desai" },
        "createdAt": "2025-06-01T12:01:00.000Z"
      }
    ]
  }
}
```

Emits `message:reaction` via Socket.IO with the full updated `reactions` array.

### 6.7 Toggle Pin

**`POST /api/chat/messages/:id/pin`**
Permission: `chat:send`

No request body needed.

```json
{
  "success": true,
  "data": {
    "action": "pinned"     // or "unpinned"
  }
}
```

Emits `message:pinned` via Socket.IO.

### 6.8 Forward Message

**`POST /api/chat/messages/:id/forward`**
Permission: `chat:send`

```json
// Request Body
{
  "targetConversationId": "<conversationId>"
}
```

Creates a new message in the target conversation with `forwardedFrom` metadata preserving the original source.

#### Response

```json
{
  "success": true,
  "message": "Message forwarded",
  "data": {
    "message": {
      "_id": "...",
      "conversation": "<targetConversationId>",
      "content": { "text": "Original message text" },
      "forwardedFrom": {
        "conversation": "<originalConversationId>",
        "message": "<originalMessageId>",
        "senderName": "Ananya Desai"
      },
      ...
    }
  }
}
```

In the UI, show a "Forwarded from Ananya Desai" label above the message.

### 6.9 Create Task from Message

**`POST /api/chat/messages/:id/create-task`**
Permission: `chat:view` + `tasks:create`

```json
// Request Body
{
  "title": "Follow up on client proposal",           // Optional, defaults to "Task from chat message"
  "category": "Sales",                                // Optional, defaults to "General"
  "priority": "High",                                 // Optional, defaults to "Medium"
  "assignedTo": "<userId>",                            // Optional, defaults to self
  "dueDate": "2025-06-15T00:00:00.000Z"              // Optional
}
```

The message's text content is automatically used as the task description.

#### Response

```json
{
  "success": true,
  "message": "Task created from message",
  "data": {
    "task": {
      "_id": "...",
      "title": "Follow up on client proposal",
      "description": "Hey team, we need to send the updated proposal to the client by Friday",
      "status": "Open",
      "source": "chat",
      ...
    }
  }
}
```

---

## 7. REST API Reference — Entity Conversations

### 7.1 Get or Create Entity Conversation

**`GET /api/chat/entity/:entityType/:entityId`**
Permission: `chat:view`

#### Supported Entity Types

| Entity Type | Display Label Format | Auto-Resolved Participants |
|------------|---------------------|---------------------------|
| `Lead` | "Lead: Amit Kulkarni" | `assignedTo` + `createdBy` |
| `Sale` | "Sale: BK-2025-001" | `salesExecutive` + `createdBy` |
| `Project` | "Project: Horizon Heights" | `projectManager` + `createdBy` |
| `Invoice` | "Invoice: INV-2025-001" | `createdBy` |
| `ConstructionMilestone` | "Milestone: Foundation Work" | `assignedTo` + `createdBy` |
| `PaymentTransaction` | "Payment #<id>" | `createdBy` + `recordedBy` |

#### Example

```
GET /api/chat/entity/Lead/683be5fd0d0e7d1234567890
```

If a conversation for this entity already exists, it returns it. Otherwise, it automatically:
1. Resolves the display label from the entity (e.g., "Lead: Amit Kulkarni")
2. Resolves participants from the entity's related users
3. Adds the requesting user as a participant
4. Creates the conversation

#### Response

```json
{
  "success": true,
  "data": {
    "conversation": {
      "_id": "...",
      "type": "entity",
      "name": "Lead: Amit Kulkarni",
      "entity": {
        "entityType": "Lead",
        "entityId": "683be5fd0d0e7d...",
        "displayLabel": "Lead: Amit Kulkarni"
      },
      "participants": [
        {
          "user": { "_id": "...", "firstName": "Priya", "lastName": "Sharma" },
          "role": "member",
          ...
        },
        {
          "user": { "_id": "...", "firstName": "Rajesh", "lastName": "Kapoor" },
          "role": "member",
          ...
        }
      ],
      ...
    }
  }
}
```

#### Usage from Other Pages

Add a "Discussion" or "Chat" button on entity detail pages:

```javascript
// On a Lead detail page
async function openEntityChat(leadId) {
  const response = await fetch(`/api/chat/entity/Lead/${leadId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { data } = await response.json();
  // Navigate to chat view with data.conversation._id
  navigateTo(`/chat/${data.conversation._id}`);
}
```

---

## 8. REST API Reference — Search & Presence

### 8.1 Search Messages

**`GET /api/chat/search`**
Permission: `chat:view`

Uses MongoDB full-text search. Only searches within conversations the user is a participant of.

#### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **(required)** | Search query (min 2 chars) |
| `limit` | number | `20` | Max results (max 50) |
| `conversationId` | string | — | Optional: search within a specific conversation only |

#### Example

```
GET /api/chat/search?q=proposal&limit=10
GET /api/chat/search?q=budget&conversationId=683be6fa0d0e...
```

#### Response

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "_id": "...",
        "content": { "text": "Here's the updated proposal for Horizon Heights" },
        "sender": { "_id": "...", "firstName": "Ananya", "lastName": "Desai", "profileImage": null },
        "conversation": {
          "_id": "...",
          "name": "Sales Leadership",
          "type": "group",
          "entity": null
        },
        "createdAt": "2025-06-01T12:00:00.000Z",
        ...
      }
    ],
    "total": 3
  }
}
```

Search results include the `conversation` field populated with `name`, `type`, and `entity` — useful for showing which conversation the result came from.

### 8.2 Get Online Users

**`GET /api/chat/online`**
Permission: `chat:view`

Returns users in the same organization who are currently connected via Socket.IO.

```json
{
  "success": true,
  "data": {
    "onlineUsers": [
      { "_id": "...", "firstName": "Rajesh", "lastName": "Kapoor", "profileImage": null },
      { "_id": "...", "firstName": "Ananya", "lastName": "Desai", "profileImage": null }
    ]
  }
}
```

**For real-time updates**: Use the `user:online` and `user:offline` Socket.IO events to keep this list current without polling.

---

## 9. Permissions & Role-Based UI Gating

### 9.1 Permission Reference

| Permission | Key | Description |
|-----------|-----|-------------|
| `chat:view` | View conversations, messages, search, online users | All chat-related roles |
| `chat:send` | Send messages, create conversations, edit/delete own messages, pin/forward | All chat-related roles |
| `chat:create_group` | Create group conversations | Level 2-4 roles + Org Owner |
| `chat:delete_any` | Delete any message in the organization | Level 2 (Project Director) + Org Owner |
| `chat:manage_groups` | Add/remove participants, update group settings | Level 2 (Project Director) + Org Owner |

### 9.2 Role Permission Matrix

| Role | Level | view | send | create_group | delete_any | manage_groups |
|------|-------|------|------|-------------|------------|---------------|
| Organization Owner | 0 | via ALL | via ALL | via ALL | via ALL | via ALL |
| Business Head | 1 | via ALL | via ALL | via ALL | via ALL | via ALL |
| Project Director | 2 | yes | yes | yes | yes | yes |
| Sales Head | 3 | yes | yes | yes | no | no |
| Marketing Head | 3 | yes | yes | yes | no | no |
| Finance Head | 3 | yes | yes | yes | no | no |
| Sales Manager | 4 | yes | yes | yes | no | no |
| Finance Manager | 4 | yes | yes | yes | no | no |
| Channel Partner Manager | 4 | yes | yes | yes | no | no |
| Sales Executive | 5 | yes | yes | no | no | no |
| Channel Partner Admin | 5 | yes | yes | no | no | no |
| Channel Partner Agent | 6 | yes | yes | no | no | no |

### 9.3 UI Gating Examples

```javascript
const userPermissions = currentUser.permissions; // string array

// Show/hide "Create Group" button
const canCreateGroup = userPermissions.includes('chat:create_group');

// Show/hide "Delete" option on messages from other users
const canDeleteAny = userPermissions.includes('chat:delete_any');

// Show "Delete" on own messages (always allowed with chat:send)
const canSendMessages = userPermissions.includes('chat:send');

// Show "Add Participants" button in group settings
const canManageGroups = userPermissions.includes('chat:manage_groups');

// In group conversation: check if user is admin
const isGroupAdmin = conversation.participants.find(
  p => p.user._id === currentUser._id && p.role === 'admin'
);

// Admin OR manage_groups permission can update group settings
const canEditGroup = isGroupAdmin || canManageGroups;
```

### 9.4 Message-Level Authorization

| Action | Who Can Do It |
|--------|--------------|
| Send message | Any participant with `chat:send` |
| Edit message | Only the message sender |
| Delete own message | The message sender with `chat:send` |
| Delete any message | Conversation admin, or user with `chat:delete_any` |
| Pin/unpin message | Any participant with `chat:send` |
| React to message | Any participant with `chat:view` |
| Forward message | Any participant with `chat:send` |
| Create task from message | Participant with `chat:view` + `tasks:create` |

---

## 10. Conversation Types & UI Behavior

### 10.1 Direct Conversations

```
┌──────────────────────────────┐
│ 🟢 Ananya Desai             │ ← Show the OTHER user's name & avatar
│ Online                       │ ← Show online status from presence
├──────────────────────────────┤
│                              │
│ Messages...                  │
│                              │
├──────────────────────────────┤
│ [Message input]        [Send]│
└──────────────────────────────┘
```

**UI Rules:**
- **Name**: Display the **other** participant's name (not "Direct" or the conversation name)
- **Avatar**: Show the other participant's profile image
- **Online status**: Show green/grey dot based on presence
- **Cannot**: Leave, add/remove participants, update name, delete conversation
- **Deduplication**: If user tries to start a new DM with someone they already have a DM with, the API returns the existing conversation

### 10.2 Group Conversations

```
┌──────────────────────────────┐
│ 👥 Sales Leadership          │ ← Show conversation name
│ 5 members                    │ ← Show member count
├──────────────────────────────┤
│                              │
│ Messages...                  │
│ [System] Rajesh created      │ ← System messages for events
│                              │
├──────────────────────────────┤
│ [Message input]        [Send]│
└──────────────────────────────┘
```

**UI Rules:**
- **Name**: Display `conversation.name`
- **Avatar**: Generic group icon or first-letter avatars of participants
- **Member count**: Show active participants count
- **Settings panel**: Name editing, description, member management
- **Admin badge**: Show "Admin" tag next to admins in member list
- **Can**: Leave (via DELETE), add/remove participants (if admin), update name/description

### 10.3 Entity Conversations

```
┌──────────────────────────────┐
│ 🏷️ Lead: Amit Kulkarni      │ ← Show entity displayLabel
│ 📋 Entity Chat • 3 members  │ ← Show entity type indicator
├──────────────────────────────┤
│                              │
│ Messages...                  │
│                              │
├──────────────────────────────┤
│ [Message input]        [Send]│
└──────────────────────────────┘
```

**UI Rules:**
- **Name**: Display `conversation.entity.displayLabel`
- **Indicator**: Show entity type badge/icon (Lead, Sale, Project, etc.)
- **Link**: Add a "View Entity" button that navigates to the entity detail page
- **Auto-created**: These are created on demand when someone opens the chat for an entity
- **Participants**: Auto-resolved from entity (assigned user, creator, etc.)

---

## 11. Message Types & Rendering Guide

### 11.1 Text Messages (`type: "text"`)

```
┌──────────────────────────────────────────────────┐
│ 👤 Rajesh Kapoor                    12:30 PM     │
│ Hello everyone! Let's discuss the project.       │
│                                                  │
│ [👍 2] [❤️ 1]                          (edited)  │
└──────────────────────────────────────────────────┘
```

- Show `content.text`
- Show `(edited)` if `isEdited === true`
- Render `reactions` grouped by emoji with count
- Highlight `@mentions` in the text (match against `mentions` array)

### 11.2 File Messages (`type: "file"`)

```
┌──────────────────────────────────────────────────┐
│ 👤 Ananya Desai                      2:15 PM     │
│ Here's the updated proposal                      │
│ ┌──────────────────────────────────────────┐     │
│ │ 📄 proposal_v2.pdf                       │     │
│ │ 305 KB • Click to download               │     │
│ └──────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

- Show `content.text` if present (message + attachment)
- Render each `attachment` as a file card
- For images (`mimeType` starts with `image/`): show thumbnail/preview
- For documents: show file icon + name + size
- The `url` field is the download link

### 11.3 System Messages (`type: "system"`)

```
┌──────────────────────────────────────────────────┐
│         ── Rajesh Kapoor created this group ──   │
│                                                  │
│         ── Ananya Desai was added ──             │
│                                                  │
│         ── Group renamed to "Sales Team" ──      │
└──────────────────────────────────────────────────┘
```

System messages have `sender: null`. Render them as centered, muted text.

| `content.systemEvent` | `content.systemData` | Display Text |
|----------------------|---------------------|--------------|
| `conversation_created` | `{ createdByName, name }` | "{createdByName} created this group" |
| `participant_added` | `{ addedByName, userIds }` | "{addedByName} added {count} participant(s)" |
| `participant_removed` | `{ removedByName, removedSelf }` | If `removedSelf`: "{removedByName} left" — else: "{removedByName} removed a participant" |
| `name_changed` | `{ changedByName, oldName, newName }` | "{changedByName} changed the group name to \"{newName}\"" |

### 11.4 Entity Reference Messages (`type: "entity_reference"`)

```
┌──────────────────────────────────────────────────┐
│ 👤 Priya Sharma                      3:00 PM     │
│ ┌──────────────────────────────────────────┐     │
│ │ 🏷️ Lead: Amit Kulkarni                  │     │
│ │ Budget: 1.5 Cr                           │     │
│ │ Status: Hot                              │     │
│ │ Phone: +91 98765 43210                   │     │
│ │                        [View Lead →]     │     │
│ └──────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

- Render as a rich card using `entityReference.displayLabel` and `entityReference.metadata`
- Add a "View {entityType}" link/button
- `metadata` is flexible — render all key-value pairs

### 11.5 Deleted Messages

```
┌──────────────────────────────────────────────────┐
│ 🚫 This message was deleted                      │
└──────────────────────────────────────────────────┘
```

Check `_isDeletedPlaceholder === true` or `isDeleted === true`. Show a muted placeholder. Do not show reactions, pins, or actions for deleted messages.

### 11.6 Forwarded Messages

```
┌──────────────────────────────────────────────────┐
│ ↪️ Forwarded from Ananya Desai                   │
│ 👤 Rajesh Kapoor                    12:30 PM     │
│ Original message text here                       │
└──────────────────────────────────────────────────┘
```

Check `forwardedFrom` object. Show a "Forwarded from {senderName}" header above the message.

### 11.7 Reply Messages

```
┌──────────────────────────────────────────────────┐
│ 👤 Rajesh Kapoor                    12:35 PM     │
│ ┌ Replying to Ananya Desai                  ┐    │
│ │ "Let's discuss the proposal timeline..."  │    │
│ └───────────────────────────────────────────┘    │
│ I agree, let's schedule a call tomorrow.         │
└──────────────────────────────────────────────────┘
```

Check `replyTo` object. Show a quoted preview of the original message with the original sender's name. Clicking the reply should scroll to the original message.

### 11.8 Pinned Messages

```
┌──────────────────────────────────────────────────┐
│ 📌 Rajesh Kapoor                    12:30 PM     │
│ Important: Q3 targets are 200 units              │
│ Pinned by Rajesh Kapoor                          │
└──────────────────────────────────────────────────┘
```

Show a pin icon on pinned messages. Optionally show "Pinned by {name}" below the message.

---

## 12. Features Implementation Guide

### 12.1 Typing Indicators

**Flow:**
1. User starts typing → emit `typing:start` to Socket.IO
2. Other users receive `typing:start` → show "{userName} is typing..."
3. User stops typing (2s debounce) → emit `typing:stop`
4. Other users receive `typing:stop` → hide indicator

**Multiple typers:**
```
"Ananya is typing..."
"Ananya and Priya are typing..."
"Ananya, Priya, and 2 others are typing..."
```

```javascript
// State: Map<conversationId, Set<{userId, userName}>>
const typingState = new Map();

socket.on('typing:start', ({ conversationId, userId, userName }) => {
  if (!typingState.has(conversationId)) {
    typingState.set(conversationId, new Map());
  }
  typingState.get(conversationId).set(userId, userName);
  updateTypingUI(conversationId);
});

socket.on('typing:stop', ({ conversationId, userId }) => {
  typingState.get(conversationId)?.delete(userId);
  updateTypingUI(conversationId);
});

function getTypingText(conversationId) {
  const typers = typingState.get(conversationId);
  if (!typers || typers.size === 0) return null;

  const names = [...typers.values()];
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing...`;
}
```

### 12.2 Unread Count & Badge

**Conversation list badge:**
```javascript
// From GET /api/chat/conversations response
const unreadCount = conversation.myUnreadCount;
// Show as badge on conversation item: (3)
```

**Total unread (app-wide badge):**
```javascript
const totalUnread = conversations.reduce(
  (sum, conv) => sum + (conv.myUnreadCount || 0), 0
);
// Show on chat icon in navbar
```

**Real-time update when new message arrives:**
```javascript
socket.on('message:new', ({ conversationId, message }) => {
  if (message.sender._id !== currentUser._id) {
    if (currentlyViewingConversation !== conversationId) {
      // Increment unread count locally
      incrementUnreadCount(conversationId);
    } else {
      // User is viewing this conversation — mark as read
      markAsRead(conversationId);
    }
  }
});
```

### 12.3 Read Receipts

Use the `conversation:read` Socket.IO event:

```javascript
socket.on('conversation:read', ({ conversationId, userId, timestamp }) => {
  // Update the participant's lastReadAt in local state
  // Use this to show double-checkmarks or "Seen by" indicators
});
```

**UI patterns:**
- **Direct chat**: Show "Seen" or double checkmark on your last message if the other person has read it
- **Group chat**: Show "Seen by 3 of 5" or list of avatar thumbnails

### 12.4 Online Presence

**Initial load:**
```javascript
const { data } = await fetch('/api/chat/online', { headers });
const onlineUserIds = new Set(data.onlineUsers.map(u => u._id));
```

**Real-time updates:**
```javascript
socket.on('user:online', ({ userId }) => {
  onlineUserIds.add(userId);
  updatePresenceUI();
});

socket.on('user:offline', ({ userId }) => {
  onlineUserIds.delete(userId);
  updatePresenceUI();
});
```

**Display:**
- Green dot on user avatar if online
- Grey dot or no indicator if offline
- In conversation list: show green dot next to the other user's name in DMs

### 12.5 Reactions

**Display grouped reactions:**
```javascript
function groupReactions(reactions) {
  const grouped = {};
  reactions.forEach(r => {
    if (!grouped[r.emoji]) {
      grouped[r.emoji] = { emoji: r.emoji, count: 0, users: [], hasReacted: false };
    }
    grouped[r.emoji].count++;
    grouped[r.emoji].users.push(r.user);
    if (r.user._id === currentUser._id) {
      grouped[r.emoji].hasReacted = true;
    }
  });
  return Object.values(grouped);
}

// Render:
// [👍 3] [❤️ 1] [😂 2]
// Highlight with different bg if current user has reacted
// Show tooltip with user names on hover
```

**Toggle reaction:**
```javascript
async function handleReaction(messageId, emoji) {
  await fetch(`/api/chat/messages/${messageId}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ emoji }),
  });
  // UI updates via Socket.IO `message:reaction` event
}
```

### 12.6 Message Forwarding

**Forward dialog flow:**
1. User clicks "Forward" on a message
2. Show a conversation picker (list from GET /api/chat/conversations)
3. User selects target conversation
4. Call POST /api/chat/messages/:id/forward

```javascript
async function forwardMessage(messageId, targetConversationId) {
  const response = await fetch(`/api/chat/messages/${messageId}/forward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ targetConversationId }),
  });
  // Navigate to target conversation or show success toast
}
```

### 12.7 Create Task from Message

**Context menu or long-press option:**
1. User right-clicks or long-presses a message
2. Shows "Create Task" option
3. Opens a mini form with pre-filled data

```javascript
async function createTaskFromMessage(messageId, overrides = {}) {
  const response = await fetch(`/api/chat/messages/${messageId}/create-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: overrides.title,           // User can edit
      category: overrides.category,     // Dropdown
      priority: overrides.priority,     // High/Medium/Low
      assignedTo: overrides.assignedTo, // User picker
      dueDate: overrides.dueDate,       // Date picker
    }),
  });
  const { data } = await response.json();
  // Show success toast: "Task created: {data.task.title}"
}
```

### 12.8 Message Search

```javascript
async function searchMessages(query, conversationId = null) {
  const params = new URLSearchParams({ q: query, limit: '20' });
  if (conversationId) params.append('conversationId', conversationId);

  const response = await fetch(`/api/chat/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { data } = await response.json();
  return data.messages;
}
```

**Search results UI:**
- Show each result with conversation name, message text (highlight matching terms), sender, and timestamp
- Clicking a result navigates to that conversation and scrolls to the message

### 12.9 Mentions (@mentions)

**Input parsing:**
```javascript
// When user types "@" in the message input:
// 1. Show a dropdown of participants in the current conversation
// 2. Filter as user types more characters
// 3. When selected, insert the mention text

function parseMentions(text, participants) {
  const mentionIds = [];
  participants.forEach(p => {
    const fullName = `${p.user.firstName} ${p.user.lastName}`;
    if (text.includes(`@${fullName}`)) {
      mentionIds.push(p.user._id);
    }
  });
  return mentionIds;
}

// When sending:
const mentions = parseMentions(messageText, conversation.participants);
await sendMessage(conversationId, { text: messageText, mentions });
```

**Rendering mentions:**
```javascript
function renderMessageText(text, mentions) {
  let rendered = text;
  mentions.forEach(user => {
    const name = `@${user.firstName} ${user.lastName}`;
    rendered = rendered.replace(
      name,
      `<span class="mention" data-user-id="${user._id}">${name}</span>`
    );
  });
  return rendered;
}
```

---

## 13. Pagination Patterns

### 13.1 Conversations — Offset-Based

```javascript
class ConversationListStore {
  page = 1;
  limit = 20;
  conversations = [];
  hasMore = true;
  loading = false;
  type = null; // 'direct' | 'group' | 'entity' | null (all)

  async loadPage(pageNum = 1) {
    this.loading = true;
    const params = new URLSearchParams({
      page: pageNum.toString(),
      limit: this.limit.toString(),
    });
    if (this.type) params.append('type', this.type);

    const response = await fetch(`/api/chat/conversations?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { data } = await response.json();

    if (pageNum === 1) {
      this.conversations = data.conversations;
    } else {
      this.conversations.push(...data.conversations);
    }

    this.page = data.pagination.currentPage;
    this.hasMore = data.pagination.hasNextPage;
    this.loading = false;
  }

  async loadMore() {
    if (this.hasMore && !this.loading) {
      await this.loadPage(this.page + 1);
    }
  }
}
```

### 13.2 Messages — Cursor-Based (Infinite Scroll Up)

```javascript
class MessageStore {
  messages = [];       // Ordered oldest → newest for rendering
  hasMore = true;
  loading = false;
  oldestId = null;

  async loadInitial(conversationId) {
    this.loading = true;
    const response = await fetch(
      `/api/chat/conversations/${conversationId}/messages?limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { data } = await response.json();

    // API returns newest-first, reverse for rendering
    this.messages = data.messages.reverse();
    this.hasMore = data.hasMore;
    this.oldestId = data.oldestId;
    this.loading = false;
  }

  async loadOlder(conversationId) {
    if (!this.hasMore || this.loading) return;

    this.loading = true;
    const response = await fetch(
      `/api/chat/conversations/${conversationId}/messages?before=${this.oldestId}&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { data } = await response.json();

    // Prepend older messages (reversed)
    this.messages = [...data.messages.reverse(), ...this.messages];
    this.hasMore = data.hasMore;
    this.oldestId = data.oldestId;
    this.loading = false;
  }

  addNewMessage(message) {
    // Called from Socket.IO 'message:new' handler
    this.messages.push(message);
  }
}
```

**Scroll position preservation:** When loading older messages (prepending), save the scroll height before loading, then restore it after the DOM updates to prevent the user from being jumped to the top.

```javascript
async function loadOlderWithScrollPreservation(containerRef) {
  const container = containerRef.current;
  const prevScrollHeight = container.scrollHeight;

  await messageStore.loadOlder(conversationId);

  // After DOM update
  requestAnimationFrame(() => {
    const newScrollHeight = container.scrollHeight;
    container.scrollTop = newScrollHeight - prevScrollHeight;
  });
}
```

---

## 14. State Management Recommendations

### 14.1 Recommended State Structure

```typescript
interface ChatState {
  // Conversation list
  conversations: Map<string, Conversation>;  // keyed by _id
  conversationOrder: string[];  // sorted by lastMessage.timestamp

  // Currently active conversation
  activeConversationId: string | null;

  // Messages per conversation
  messages: Map<string, Message[]>;  // keyed by conversationId
  messagesPagination: Map<string, { hasMore: boolean; oldestId: string | null }>;

  // Presence
  onlineUserIds: Set<string>;

  // Typing indicators
  typingUsers: Map<string, Map<string, string>>;  // conversationId -> userId -> userName

  // UI state
  isSocketConnected: boolean;
  searchResults: Message[];
}
```

### 14.2 Optimistic Updates

For better UX, update the UI optimistically before the server responds:

```javascript
// Optimistic send
function sendMessageOptimistic(conversationId, text) {
  const tempId = `temp_${Date.now()}`;
  const optimisticMessage = {
    _id: tempId,
    conversation: conversationId,
    sender: currentUser,
    type: 'text',
    content: { text },
    createdAt: new Date().toISOString(),
    _isOptimistic: true,  // Custom flag for UI
  };

  // Add to messages immediately
  addMessage(conversationId, optimisticMessage);

  // Send via REST
  fetch(`/api/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  })
  .then(res => res.json())
  .then(({ data }) => {
    // Replace optimistic message with real one
    replaceMessage(conversationId, tempId, data.message);
  })
  .catch(err => {
    // Mark as failed
    markMessageFailed(conversationId, tempId);
  });
}
```

### 14.3 Deduplication

When receiving `message:new` via Socket.IO, the sender will also get the event (since they're in the room). Deduplicate:

```javascript
socket.on('message:new', ({ conversationId, message }) => {
  // Skip if this is our own message (already added optimistically)
  if (message.sender?._id === currentUser._id) {
    // Check if we already have this message (by real ID)
    const exists = messages.get(conversationId)?.some(m => m._id === message._id);
    if (exists) return;

    // Replace optimistic version if exists
    const optimistic = messages.get(conversationId)?.find(m => m._isOptimistic);
    if (optimistic) {
      replaceMessage(conversationId, optimistic._id, message);
      return;
    }
  }

  addMessage(conversationId, message);
});
```

### 14.4 Conversation List Updates

When a new message arrives, update the conversation list:

```javascript
socket.on('message:new', ({ conversationId, message }) => {
  const conv = conversations.get(conversationId);
  if (conv) {
    // Update lastMessage
    conv.lastMessage = {
      text: message.content?.text?.substring(0, 100) || 'Sent an attachment',
      sender: message.sender,
      senderName: message.sender ? `${message.sender.firstName} ${message.sender.lastName}` : '',
      timestamp: message.createdAt,
      messageType: message.type,
    };

    // Increment unread if not currently viewing
    if (activeConversationId !== conversationId && message.sender?._id !== currentUser._id) {
      conv.myUnreadCount = (conv.myUnreadCount || 0) + 1;
    }

    // Re-sort conversation list (move to top)
    reorderConversations();
  }
});
```

---

## 15. Error Handling

### 15.1 HTTP Error Responses

All errors follow this format:

```json
{
  "success": false,
  "message": "Error description",
  "stack": "..." // Only in development
}
```

### 15.2 Common Error Codes

| Status | Error Message | Cause | UI Action |
|--------|--------------|-------|-----------|
| 400 | `type must be "direct" or "group"` | Invalid conversation type | Show validation error |
| 400 | `Direct conversation requires exactly one other participant ID` | Wrong participant count for DM | Show validation error |
| 400 | `Group conversation requires at least one other participant` | Empty group | Show validation error |
| 400 | `Cannot update direct conversations` | Tried to rename a DM | Hide edit button for DMs |
| 400 | `Cannot add participants to direct conversations` | Tried to add to DM | Hide add-member for DMs |
| 400 | `Cannot leave a direct conversation` | Tried to leave DM | Hide leave button for DMs |
| 400 | `Message must have text, attachments, or entity reference` | Empty message | Disable send button when input is empty |
| 400 | `Message text is required` | Empty edit | Validate before sending edit |
| 400 | `Emoji is required` | Missing emoji in reaction | Always include emoji in payload |
| 400 | `Target conversation ID is required` | Missing forward target | Require selection before forwarding |
| 400 | `Search query must be at least 2 characters` | Short search query | Show "Enter at least 2 characters" |
| 400 | `Invalid entity type` | Unknown entity type | Only show valid entity types |
| 403 | `Not authorized to create group conversations` | Missing `chat:create_group` | Hide create group button |
| 403 | `Only admins can update group settings` | Not admin | Hide edit in group settings |
| 403 | `Only admins can add participants` | Not admin | Hide add-member button |
| 403 | `Not authorized to send messages in this conversation` | Not a participant | Show "You're not part of this conversation" |
| 403 | `Not authorized to delete this message` | Not own msg / not admin | Hide delete option |
| 403 | `Not authorized to create tasks` | Missing `tasks:create` | Hide create-task option |
| 404 | `Conversation not found` | Invalid ID or not participant | Show "Conversation not found" |
| 404 | `Message not found` | Invalid ID or deleted | Show toast "Message not found" |
| 404 | `Target user not found in your organization` | User ID doesn't exist | Show "User not found" |

### 15.3 Socket.IO Error Handling

```javascript
// Connection errors
socket.on('connect_error', (err) => {
  if (err.message.includes('Authentication')) {
    // Token expired or invalid — redirect to login
    redirectToLogin();
  } else {
    // Network error — show reconnecting indicator
    showReconnectingBanner();
  }
});

// Reconnection
socket.on('reconnect', (attemptNumber) => {
  hideReconnectingBanner();
  // Re-fetch conversations to sync any missed messages
  refreshConversations();
});

socket.on('reconnect_failed', () => {
  showOfflineBanner();
});
```

---

## 16. Demo Data & Testing

### 16.1 Demo Credentials

```
Organization: Prestige Horizon Developers
Password (all users): Demo@1234
```

| User | Email | Role |
|------|-------|------|
| Rajesh Kapoor | rajesh.kapoor@prestige.com | Organization Owner |
| Ananya Desai | ananya.desai@prestige.com | Business Head |
| Priya Sharma | priya.sharma@prestige.com | Sales Head |
| Sanjay Mehta | sanjay.mehta@prestige.com | Sales Manager |
| Neha Singh | neha.singh@prestige.com | Sales Executive |
| Vikram Patel | vikram.patel@prestige.com | Finance Head |
| Meera Joshi | meera.joshi@prestige.com | Finance Manager |
| Arjun Rao | arjun.rao@prestige.com | Marketing Head |
| Pooja Gupta | pooja.gupta@prestige.com | Project Director |
| Kiran Deshmukh | kiran.deshmukh@prestige.com | Channel Partner Manager |

### 16.2 Seeded Chat Data

**Direct Conversations (4):**
1. Rajesh Kapoor ↔ Ananya Desai — 6 messages about sales strategy
2. Priya Sharma ↔ Sanjay Mehta — 5 messages about sales pipeline
3. Neha Singh ↔ Sanjay Mehta — 4 messages about lead follow-up
4. Vikram Patel ↔ Meera Joshi — 4 messages about budget review

**Group Conversations (3):**
1. "Sales Leadership" — Rajesh, Ananya, Priya, Sanjay, Arjun — 6 messages
2. "Horizon Heights Project Team" — Rajesh, Pooja, Priya, Vikram — 7 messages (1 pinned)
3. "Finance & Collections" — Vikram, Meera, Rajesh, Priya — 4 messages

**Entity Conversations (2):**
1. Lead: Amit Kulkarni — Priya, Sanjay, Neha — 6 messages
2. Project: Horizon Heights — Rajesh, Pooja — 3 messages

**Total**: 9 conversations, 45 messages

### 16.3 Running the Seed

```bash
# Seed all demo data (including chat)
node data/seedDemoData.js

# Clean all demo data first, then re-seed
node data/seedDemoData.js --clean
```

### 16.4 Quick API Testing Flow

```bash
# 1. Login as Rajesh
TOKEN=$(curl -s http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"rajesh.kapoor@prestige.com","password":"Demo@1234"}' \
  | jq -r '.data.token')

# 2. List conversations
curl -s http://localhost:3000/api/chat/conversations \
  -H "Authorization: Bearer $TOKEN" | jq '.data.conversations | length'
# → 4 (Rajesh is in 4 conversations)

# 3. Get messages in first conversation
CONV_ID=$(curl -s http://localhost:3000/api/chat/conversations \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.conversations[0]._id')

curl -s "http://localhost:3000/api/chat/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.messages | length'

# 4. Send a message
curl -s "http://localhost:3000/api/chat/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from API test!"}' | jq '.data.message.content.text'

# 5. Search
curl -s "http://localhost:3000/api/chat/search?q=budget" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.messages | length'

# 6. Online users
curl -s http://localhost:3000/api/chat/online \
  -H "Authorization: Bearer $TOKEN" | jq '.data.onlineUsers'
```

---

## 17. UI Component Hierarchy

### 17.1 Recommended Component Tree

```
<ChatApp>
├── <ChatSidebar>
│   ├── <ChatSearch />                    // Search input with debounce
│   ├── <ConversationTypeTabs />          // All | Direct | Group | Entity
│   ├── <NewConversationButton />         // "+ New" → Direct or Group
│   ├── <ConversationList>
│   │   └── <ConversationItem>            // Avatar, name, lastMessage, unread badge, time
│   │       ├── <OnlineIndicator />       // Green/grey dot
│   │       └── <UnreadBadge />           // Count
│   └── <LoadMoreButton />               // Pagination
├── <ChatView>                            // Main chat area (when conversation selected)
│   ├── <ChatHeader>
│   │   ├── <ConversationInfo />          // Name, type, member count
│   │   ├── <OnlineStatus />             // For direct chats
│   │   ├── <PinnedMessagesButton />     // Open pinned panel
│   │   ├── <SearchInConversation />     // Search within this conversation
│   │   └── <ConversationSettings />     // Gear icon → settings panel
│   ├── <MessageList>
│   │   ├── <LoadOlderTrigger />         // Infinite scroll trigger (at top)
│   │   ├── <DateSeparator />            // "Today", "Yesterday", "June 1, 2025"
│   │   └── <MessageBubble>
│   │       ├── <ReplyPreview />         // If replyTo exists
│   │       ├── <ForwardedLabel />       // If forwardedFrom exists
│   │       ├── <SenderInfo />           // Avatar + name (in groups)
│   │       ├── <MessageContent>         // Text / File / System / EntityRef
│   │       │   ├── <TextContent />      // With @mention highlighting
│   │       │   ├── <FileAttachment />   // File card with download
│   │       │   ├── <SystemMessage />    // Centered, muted
│   │       │   └── <EntityCard />       // Rich card with entity info
│   │       ├── <PinIndicator />         // 📌 if pinned
│   │       ├── <EditedIndicator />      // "(edited)" if isEdited
│   │       ├── <ReactionBar />          // Grouped emoji reactions
│   │       ├── <MessageTimestamp />     // Time + read receipts
│   │       └── <MessageActions />       // Hover/right-click menu
│   │           ├── Reply
│   │           ├── React (emoji picker)
│   │           ├── Pin / Unpin
│   │           ├── Forward
│   │           ├── Edit (own messages only)
│   │           ├── Delete
│   │           └── Create Task
│   ├── <TypingIndicator />              // "Ananya is typing..."
│   └── <MessageInput>
│       ├── <ReplyPreviewBar />          // Shows when replying
│       ├── <MentionDropdown />          // Shows when @ is typed
│       ├── <AttachmentButton />         // File picker
│       ├── <EmojiPicker />              // Emoji button
│       └── <SendButton />              // Send (Enter key)
├── <PinnedMessagesPanel />              // Slide-over panel
├── <ConversationSettingsPanel />        // Slide-over panel
│   ├── <GroupNameEditor />
│   ├── <GroupDescription />
│   ├── <MemberList>
│   │   └── <MemberItem>                // Avatar, name, role badge, remove button
│   ├── <AddMembersButton />
│   ├── <ArchiveButton />
│   └── <LeaveButton />
├── <NewConversationDialog>              // Modal
│   ├── <TypeSelector />                 // Direct or Group
│   ├── <UserSearchPicker />             // Search and select users
│   ├── <GroupNameInput />               // Only for groups
│   └── <CreateButton />
├── <ForwardMessageDialog>               // Modal
│   └── <ConversationPicker />           // Select target conversation
├── <CreateTaskFromMessageDialog>        // Modal
│   ├── <TitleInput />
│   ├── <CategorySelect />
│   ├── <PrioritySelect />
│   ├── <AssigneeSelect />
│   └── <DueDatePicker />
├── <SearchResultsPanel />               // Global search results
│   └── <SearchResultItem>               // Conversation name + message preview
└── <EmptyState />                       // When no conversation selected
    └── "Select a conversation to start chatting"
```

### 17.2 Direct Chat Name Resolution

For direct conversations, the conversation has no meaningful `name`. Instead, show the **other** participant's name:

```javascript
function getConversationDisplayName(conversation, currentUserId) {
  if (conversation.type === 'direct') {
    const otherParticipant = conversation.participants.find(
      p => p.user._id !== currentUserId && p.isActive
    );
    if (otherParticipant?.user) {
      return `${otherParticipant.user.firstName} ${otherParticipant.user.lastName}`;
    }
    return 'Unknown User';
  }

  if (conversation.type === 'entity' && conversation.entity?.displayLabel) {
    return conversation.entity.displayLabel;
  }

  return conversation.name || 'Unnamed Group';
}

function getConversationAvatar(conversation, currentUserId) {
  if (conversation.type === 'direct') {
    const otherParticipant = conversation.participants.find(
      p => p.user._id !== currentUserId && p.isActive
    );
    return otherParticipant?.user?.profileImage || null;
  }
  return null; // Use group icon or first-letter avatars
}
```

### 17.3 Date Separators in Message List

Group messages by date and show separators:

```javascript
function getDateLabel(dateString) {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Insert separators between messages with different dates
function messagesWithDateSeparators(messages) {
  const result = [];
  let lastDate = null;

  messages.forEach(msg => {
    const msgDate = new Date(msg.createdAt).toDateString();
    if (msgDate !== lastDate) {
      result.push({ _type: 'date_separator', label: getDateLabel(msg.createdAt) });
      lastDate = msgDate;
    }
    result.push(msg);
  });

  return result;
}
```

### 17.4 Message Grouping (Same Sender)

Group consecutive messages from the same sender (within a time window):

```javascript
function shouldShowSenderInfo(message, previousMessage) {
  if (!previousMessage) return true;
  if (message.type === 'system') return false;
  if (previousMessage.type === 'system') return true;
  if (message.sender?._id !== previousMessage.sender?._id) return true;

  // Show sender again if more than 5 minutes apart
  const timeDiff = new Date(message.createdAt) - new Date(previousMessage.createdAt);
  return timeDiff > 5 * 60 * 1000;
}
```

### 17.5 Responsive Layout

```
Desktop (>1024px):
┌─────────────┬──────────────────────────────┐
│  Sidebar    │  Chat View                   │
│  (350px)    │  (flex: 1)                   │
│             │                              │
│  Conv List  │  Header                      │
│             │  Messages                    │
│             │  Input                       │
└─────────────┴──────────────────────────────┘

Mobile (<1024px):
┌──────────────────────────────┐
│  Conv List (full width)      │ ← Default view
│                              │
│  Tap → slides to Chat View   │
└──────────────────────────────┘
      or
┌──────────────────────────────┐
│  ← Back   Chat View          │ ← After selecting conversation
│                              │
│  Messages                    │
│  Input                       │
└──────────────────────────────┘
```

---

## Quick Reference: All API Endpoints

| # | Method | Endpoint | Permission | Description |
|---|--------|----------|------------|-------------|
| 1 | POST | `/api/chat/conversations` | chat:send | Create direct/group conversation |
| 2 | GET | `/api/chat/conversations` | chat:view | List conversations (paginated) |
| 3 | GET | `/api/chat/conversations/:id` | chat:view | Get conversation details |
| 4 | PUT | `/api/chat/conversations/:id` | chat:send | Update conversation |
| 5 | DELETE | `/api/chat/conversations/:id` | chat:view | Leave conversation |
| 6 | POST | `/api/chat/conversations/:id/participants` | chat:send | Add participants |
| 7 | DELETE | `/api/chat/conversations/:id/participants/:userId` | chat:send | Remove participant |
| 8 | PUT | `/api/chat/conversations/:id/read` | chat:view | Mark as read |
| 9 | PUT | `/api/chat/conversations/:id/archive` | chat:view | Archive/unarchive |
| 10 | POST | `/api/chat/conversations/:id/messages` | chat:send | Send message |
| 11 | GET | `/api/chat/conversations/:id/messages` | chat:view | Get messages (cursor-based) |
| 12 | GET | `/api/chat/conversations/:id/messages/pinned` | chat:view | Get pinned messages |
| 13 | PUT | `/api/chat/messages/:id` | chat:send | Edit message (own only) |
| 14 | DELETE | `/api/chat/messages/:id` | chat:send | Delete message (soft) |
| 15 | POST | `/api/chat/messages/:id/reactions` | chat:view | Toggle reaction |
| 16 | POST | `/api/chat/messages/:id/pin` | chat:send | Toggle pin |
| 17 | POST | `/api/chat/messages/:id/forward` | chat:send | Forward message |
| 18 | POST | `/api/chat/messages/:id/create-task` | chat:view + tasks:create | Create task from message |
| 19 | GET | `/api/chat/entity/:entityType/:entityId` | chat:view | Get/create entity conversation |
| 20 | GET | `/api/chat/search` | chat:view | Search messages |
| 21 | GET | `/api/chat/online` | chat:view | Get online users |

---

## Quick Reference: All Socket.IO Events

| Direction | Event | Payload |
|-----------|-------|---------|
| Client → Server | `conversation:join` | `{ conversationId }` |
| Client → Server | `conversation:leave` | `{ conversationId }` |
| Client → Server | `conversation:read` | `{ conversationId }` + callback |
| Client → Server | `typing:start` | `{ conversationId }` |
| Client → Server | `typing:stop` | `{ conversationId }` |
| Server → Client | `message:new` | `{ conversationId, message }` |
| Server → Client | `message:edited` | `{ conversationId, messageId, text, isEdited, editedAt }` |
| Server → Client | `message:deleted` | `{ conversationId, messageId }` |
| Server → Client | `message:reaction` | `{ conversationId, messageId, userId, emoji, action, reactions }` |
| Server → Client | `message:pinned` | `{ conversationId, messageId, isPinned, pinnedBy }` |
| Server → Client | `conversation:updated` | `{ conversationId, changes }` |
| Server → Client | `conversation:read` | `{ conversationId, userId, timestamp }` |
| Server → Client | `typing:start` | `{ conversationId, userId, userName }` |
| Server → Client | `typing:stop` | `{ conversationId, userId }` |
| Server → Client | `user:online` | `{ userId }` |
| Server → Client | `user:offline` | `{ userId }` |

---

*End of documentation. This covers all 21 REST endpoints, all Socket.IO events, complete data models, permissions, UI patterns, and implementation guides needed to build the frontend chat interface.*
