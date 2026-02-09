# PropVantage AI - Frontend Developer Documentation

## Version 1.8.0 | Complete API Reference & Integration Guide

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Getting Started](#2-getting-started)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Role-Based Access Control (RBAC)](#4-role-based-access-control-rbac)
5. [API Reference](#5-api-reference)
   - [Authentication APIs](#51-authentication-apis)
   - [User Management APIs](#52-user-management-apis)
   - [Invitation APIs](#53-invitation-apis)
   - [Project APIs](#54-project-apis)
   - [Tower APIs](#55-tower-apis)
   - [Unit APIs](#56-unit-apis)
   - [Lead APIs](#57-lead-apis)
   - [Sales APIs](#58-sales-apis)
   - [Payment APIs](#59-payment-apis)
   - [Invoice APIs](#510-invoice-apis)
   - [Commission APIs](#511-commission-apis)
   - [Document APIs](#512-document-apis)
   - [Construction APIs](#513-construction-apis)
   - [Contractor APIs](#514-contractor-apis)
   - [Analytics APIs](#515-analytics-apis)
   - [AI APIs](#516-ai-apis)
   - [Pricing APIs](#517-pricing-apis)
   - [File Upload APIs](#518-file-upload-apis)
6. [Data Models & Schemas](#6-data-models--schemas)
7. [Business Flows](#7-business-flows)
8. [Error Handling](#8-error-handling)
9. [Best Practices](#9-best-practices)

---

## 1. Project Overview

**PropVantage AI** is a comprehensive, AI-powered CRM platform for the real estate industry. It provides:

- **Lead Management** with AI-powered scoring and insights
- **Project & Inventory Management** (Projects, Towers, Units)
- **Sales Management** with pipeline tracking
- **Payment & Installment Management**
- **Commission Management** for channel partners
- **Document Management** with approval workflows
- **Construction Management** with milestone tracking
- **AI-Powered Features**: Lead insights, conversation analysis, predictive analytics
- **Advanced Analytics** and reporting

### Technology Stack
- **Backend**: Node.js + Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **AI Integration**: OpenAI GPT-4
- **File Storage**: AWS S3
- **Email**: Nodemailer

---

## 2. Getting Started

### Base URL
```
Development: http://localhost:3000/api
Production: https://your-domain.com/api
```

### Request Headers
All authenticated requests must include:
```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### Response Format
All API responses follow this structure:
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... }
}
```

Error responses:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

---

## 3. Authentication & Authorization

### JWT Token
- Tokens are valid for **30 days**
- Include in `Authorization` header as `Bearer <token>`
- Token contains: `userId`, `iat` (issued at), `exp` (expiration)

### Authentication Flow

```
1. User Login/Register → Receive JWT Token
2. Store token in localStorage/sessionStorage
3. Include token in all subsequent API requests
4. Handle 401 errors by redirecting to login
```

---

## 4. Role-Based Access Control (RBAC)

### Available Roles (Hierarchy)

| Level | Role | Description |
|-------|------|-------------|
| 1 | Business Head | Full access to all features |
| 2 | Project Director | Project-level admin access |
| 3 | Sales Head | Sales team management |
| 3 | Marketing Head | Marketing & lead generation |
| 3 | Finance Head | Financial operations |
| 4 | Sales Manager | Sales operations |
| 4 | Finance Manager | Finance operations |
| 4 | Channel Partner Manager | Partner management |
| 5 | Sales Executive | Sales operations |
| 5 | Channel Partner Admin | Partner admin |
| 6 | Channel Partner Agent | Partner agent |

### Role Permissions Summary

| Feature | Business Head | Project Director | Sales Head | Sales Manager | Sales Executive |
|---------|--------------|------------------|------------|---------------|-----------------|
| Create Projects | ✅ | ✅ | ❌ | ❌ | ❌ |
| View Projects | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage Users | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create Sales | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cancel Sales | ✅ | ✅ | ✅ | ❌ | ❌ |
| View Analytics | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage Commissions | ✅ | ✅ | ✅ | ✅ | ❌ |

---

## 5. API Reference

### 5.1 Authentication APIs

#### POST /api/auth/register
**Description**: Register a new organization and admin user (Business Head)

**Access**: Public

**Request Body**:
```json
{
  "orgName": "ABC Developers",
  "country": "India",
  "city": "Mumbai",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@abcdevelopers.com",
  "password": "SecurePass@123"
}
```

**Password Requirements**:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character (!@#$%^&*(),.?":{}|<>)

**Response (201)**:
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@abcdevelopers.com",
  "role": "Business Head",
  "organization": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "ABC Developers"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

#### POST /api/auth/login
**Description**: Authenticate user and get token

**Access**: Public

**Request Body**:
```json
{
  "email": "john@abcdevelopers.com",
  "password": "SecurePass@123"
}
```

**Response (200)**:
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@abcdevelopers.com",
  "role": "Business Head",
  "organization": "507f1f77bcf86cd799439012",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Responses**:
- `401`: Invalid email or password

---

### 5.2 User Management APIs

#### GET /api/users/me
**Description**: Get current user's profile

**Access**: Private (Any authenticated user)

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@abcdevelopers.com",
    "role": "Business Head",
    "organization": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "ABC Developers"
    },
    "isActive": true,
    "lastLogin": "2024-01-15T10:30:00.000Z",
    "phoneNumber": "+91-9876543210",
    "preferences": {
      "language": "en",
      "timezone": "Asia/Kolkata",
      "notifications": {
        "email": true,
        "push": true,
        "sms": false
      }
    }
  }
}
```

---

#### PUT /api/users/me
**Description**: Update current user's profile

**Access**: Private (Any authenticated user)

**Rate Limit**: 10 requests per 15 minutes

**Request Body**:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phoneNumber": "+91-9876543210",
  "profileImage": "https://example.com/image.jpg",
  "preferences": {
    "language": "en",
    "timezone": "Asia/Kolkata",
    "notifications": {
      "email": true,
      "push": true,
      "sms": false
    }
  }
}
```

---

#### GET /api/users
**Description**: Get all users for the organization with filtering and pagination

**Access**: Private (Management roles)

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| page | number | Page number (default: 1) |
| limit | number | Items per page (default: 20) |
| role | string | Filter by role |
| status | string | Filter by status (active/inactive) |
| search | string | Search by name or email |
| includeInactive | boolean | Include inactive users |
| sortBy | string | Sort field |
| sortOrder | string | 'asc' or 'desc' |

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "firstName": "John",
        "lastName": "Doe",
        "email": "john@example.com",
        "role": "Sales Manager",
        "isActive": true,
        "invitationStatus": "accepted",
        "lastLogin": "2024-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalUsers": 48,
      "limit": 10
    }
  }
}
```

---

#### GET /api/users/:id
**Description**: Get single user by ID

**Access**: Private (Management roles)

---

#### PUT /api/users/:id
**Description**: Update user role, status, or profile

**Access**: Private (Management roles)

**Request Body**:
```json
{
  "role": "Sales Manager",
  "isActive": true,
  "firstName": "John",
  "lastName": "Smith"
}
```

---

#### DELETE /api/users/:id
**Description**: Soft delete (deactivate) a user

**Access**: Private (Business Head, Project Director only)

---

### 5.3 Invitation APIs

#### POST /api/invitations/generate
**Description**: Generate invitation link for new user

**Access**: Private (Management roles)

**Request Body**:
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@example.com",
  "role": "Sales Executive"
}
```

**Response (201)**:
```json
{
  "success": true,
  "message": "Invitation generated successfully",
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "invitationLink": "https://your-frontend.com/accept-invitation?userId=507f1f77bcf86cd799439011&token=abc123&email=jane@example.com",
    "token": "abc123def456",
    "expiresAt": "2024-01-22T10:30:00.000Z"
  }
}
```

---

#### GET /api/invitations/verify/:userId
**Description**: Verify invitation token (for invitation acceptance page)

**Access**: Public

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| token | string | Yes | Invitation token |
| email | string | Yes | User email |

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "isValid": true,
    "user": {
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane@example.com",
      "role": "Sales Executive"
    },
    "organization": {
      "name": "ABC Developers"
    },
    "expiresAt": "2024-01-22T10:30:00.000Z"
  }
}
```

---

#### POST /api/invitations/accept/:userId
**Description**: Accept invitation and set password

**Access**: Public

**Request Body**:
```json
{
  "token": "abc123def456",
  "email": "jane@example.com",
  "password": "SecurePass@123",
  "confirmPassword": "SecurePass@123"
}
```

**Response (200)**:
```json
{
  "success": true,
  "message": "Invitation accepted successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@example.com",
    "role": "Sales Executive",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

#### GET /api/invitations/status/:userId
**Description**: Get invitation status

**Access**: Public

---

#### POST /api/invitations/resend/:userId
**Description**: Resend invitation (generates new token)

**Access**: Private (Management roles)

---

#### DELETE /api/invitations/revoke/:userId
**Description**: Revoke pending invitation

**Access**: Private (Management roles)

---

### 5.4 Project APIs

#### POST /api/projects
**Description**: Create a new project

**Access**: Private (Business Head, Project Director)

**Request Body**:
```json
{
  "name": "Green Valley Residency",
  "description": "Premium residential apartments",
  "type": "apartment",
  "status": "pre-launch",
  "location": {
    "city": "Mumbai",
    "area": "Bandra",
    "pincode": "400050",
    "state": "Maharashtra",
    "landmark": "Near Bandra Station"
  },
  "totalUnits": 200,
  "totalArea": 500000,
  "priceRange": {
    "min": 5000000,
    "max": 15000000
  },
  "targetRevenue": 1500000000,
  "launchDate": "2024-03-01",
  "expectedCompletionDate": "2027-06-01",
  "amenities": ["Swimming Pool", "Gym", "Club House", "Garden"],
  "approvals": {
    "rera": {
      "number": "P52000012345",
      "date": "2023-12-01",
      "validUntil": "2027-12-01"
    }
  },
  "pricingRules": {
    "gstRate": 5,
    "tdsRate": 1,
    "floorRiseCharge": 25000,
    "plcCharges": {
      "parkFacing": 100000,
      "cornerUnit": 75000
    }
  },
  "paymentConfiguration": {
    "defaultPaymentTerms": {
      "gracePeriodDays": 7,
      "lateFeeRate": 2
    },
    "taxConfiguration": {
      "gstApplicable": true,
      "gstRate": 5,
      "stampDutyRate": 5,
      "registrationFeeRate": 1
    }
  }
}
```

**Project Types**: `apartment`, `villa`, `plot`, `commercial`

**Project Status**: `planning`, `pre-launch`, `launched`, `under-construction`, `completed`, `on-hold`

**Response (201)**:
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Green Valley Residency",
    "type": "apartment",
    "status": "pre-launch",
    "totalUnits": 200,
    "targetRevenue": 1500000000,
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

#### GET /api/projects
**Description**: Get all projects for organization

**Access**: Private (All roles with view permission)

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status |
| type | string | Filter by project type |
| page | number | Page number |
| limit | number | Items per page |

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Green Valley Residency",
      "type": "apartment",
      "status": "launched",
      "location": {
        "city": "Mumbai",
        "area": "Bandra"
      },
      "totalUnits": 200,
      "priceRange": {
        "min": 5000000,
        "max": 15000000
      },
      "targetRevenue": 1500000000
    }
  ]
}
```

---

#### GET /api/projects/:id
**Description**: Get project by ID

**Access**: Private (All roles with view permission)

---

#### PUT /api/projects/:id
**Description**: Update project

**Access**: Private (Business Head, Project Director, Sales Head, Marketing Head)

---

#### DELETE /api/projects/:id
**Description**: Delete project

**Access**: Private (Business Head, Project Director)

---

#### GET /api/projects/:id/budget-variance
**Description**: Get real-time budget variance analysis for a project

**Access**: Private (Management roles)

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "project": {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Green Valley Residency",
      "targetRevenue": 1500000000
    },
    "budgetAnalysis": {
      "targetRevenue": 1500000000,
      "actualRevenue": 450000000,
      "varianceAmount": -1050000000,
      "variancePercentage": -70,
      "status": "Under Budget"
    },
    "salesAnalysis": {
      "totalUnits": 200,
      "soldUnits": 45,
      "availableUnits": 155,
      "salesPercentage": 22.5
    },
    "projections": {
      "averageSalePrice": 10000000,
      "projectedRevenue": 2000000000,
      "targetPricePerUnit": 7500000
    }
  }
}
```

---

### 5.5 Tower APIs

#### POST /api/towers
**Description**: Create a new tower within a project

**Access**: Private (Management roles)

**Request Body**:
```json
{
  "project": "507f1f77bcf86cd799439011",
  "towerName": "Tower A",
  "towerCode": "TWR-A",
  "totalFloors": 25,
  "unitsPerFloor": 8,
  "towerType": "residential",
  "status": "under_construction",
  "configuration": {
    "elevators": { "count": 3, "type": "passenger" },
    "staircases": { "count": 2, "type": "fire_exit" },
    "powerBackup": "full",
    "waterSupply": "mixed"
  },
  "pricingConfiguration": {
    "basePriceModifier": 1.0,
    "floorPremium": {
      "startFloor": 5,
      "premiumPerFloor": 25000
    },
    "cornerUnitPremium": {
      "percentage": 5
    }
  }
}
```

**Tower Types**: `residential`, `commercial`, `mixed_use`, `parking`

**Tower Status**: `planning`, `under_construction`, `completed`, `on_hold`, `cancelled`

---

#### GET /api/towers
**Description**: Get all towers

**Access**: Private (All roles)

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| project | ObjectId | Filter by project ID |

---

#### GET /api/towers/:id
**Description**: Get tower by ID

---

#### PUT /api/towers/:id
**Description**: Update tower

---

#### DELETE /api/towers/:id
**Description**: Delete tower

---

#### GET /api/towers/:id/analytics
**Description**: Get tower analytics (sales, revenue, unit status)

---

#### POST /api/towers/:id/units/bulk-create
**Description**: Bulk create units for a tower

**Request Body**:
```json
{
  "units": [
    {
      "unitNumber": "A-101",
      "type": "2BHK",
      "floor": 1,
      "areaSqft": 1200,
      "basePrice": 6000000,
      "facing": "East"
    }
  ]
}
```

---

### 5.6 Unit APIs

#### POST /api/units
**Description**: Create a new unit

**Access**: Private (Management roles)

**Request Body**:
```json
{
  "project": "507f1f77bcf86cd799439011",
  "tower": "507f1f77bcf86cd799439012",
  "unitNumber": "A-101",
  "type": "2BHK",
  "floor": 10,
  "areaSqft": 1200,
  "basePrice": 6000000,
  "currentPrice": 6500000,
  "facing": "East",
  "status": "available",
  "features": {
    "isParkFacing": true,
    "isCornerUnit": false,
    "hasBalcony": true,
    "hasServantRoom": false,
    "hasParkingSlot": true
  },
  "specifications": {
    "bedrooms": 2,
    "bathrooms": 2,
    "livingRooms": 1,
    "kitchen": 1,
    "balconies": 2,
    "carpetArea": 900,
    "builtUpArea": 1050,
    "superBuiltUpArea": 1200
  },
  "parking": {
    "covered": 1,
    "open": 0,
    "parkingNumbers": ["P-101"]
  }
}
```

**Unit Types**: `1BHK`, `2BHK`, `3BHK`, `4BHK`, `Villa`, `Plot`, `Commercial`, etc.

**Unit Status**: `available`, `booked`, `sold`, `blocked`

**Facing**: `North`, `South`, `East`, `West`, `North-East`, `North-West`, `South-East`, `South-West`

---

#### GET /api/units
**Description**: Get all units

**Access**: Private (All roles)

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| project | ObjectId | Filter by project |
| tower | ObjectId | Filter by tower |
| status | string | Filter by status |
| type | string | Filter by unit type |
| minPrice | number | Minimum price |
| maxPrice | number | Maximum price |
| floor | number | Filter by floor |

---

#### GET /api/units/statistics
**Description**: Get unit statistics (counts by status, type, etc.)

**Access**: Private (All roles)

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "totalUnits": 200,
    "byStatus": {
      "available": 150,
      "booked": 30,
      "sold": 15,
      "blocked": 5
    },
    "byType": {
      "1BHK": 40,
      "2BHK": 100,
      "3BHK": 50,
      "4BHK": 10
    },
    "totalValue": {
      "available": 975000000,
      "sold": 112500000
    }
  }
}
```

---

#### GET /api/units/:id
**Description**: Get unit by ID

---

#### PUT /api/units/:id
**Description**: Update unit

---

#### DELETE /api/units/:id
**Description**: Delete unit

---

### 5.7 Lead APIs

#### POST /api/leads
**Description**: Create a new lead

**Access**: Private (All sales roles)

**Request Body**:
```json
{
  "project": "507f1f77bcf86cd799439011",
  "firstName": "Rahul",
  "lastName": "Sharma",
  "email": "rahul@example.com",
  "phone": "+91-9876543210",
  "source": "Website",
  "assignedTo": "507f1f77bcf86cd799439012",
  "budget": {
    "min": 5000000,
    "max": 8000000
  },
  "requirements": {
    "timeline": "3-6_months",
    "unitType": "2BHK",
    "floor": {
      "preference": "high"
    },
    "facing": "East",
    "amenities": ["Gym", "Swimming Pool"]
  },
  "notes": "Customer prefers sea-facing unit"
}
```

**Lead Sources**: `Website`, `Property Portal`, `Referral`, `Walk-in`, `Social Media`, `Advertisement`, `Cold Call`, `Other`

**Lead Status**: `New`, `Contacted`, `Qualified`, `Site Visit Scheduled`, `Site Visit Completed`, `Negotiating`, `Booked`, `Lost`, `Unqualified`

**Timeline Options**: `immediate`, `1-3_months`, `3-6_months`, `6-12_months`, `12+_months`

---

#### GET /api/leads
**Description**: Get all leads

**Access**: Private (All roles)

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| project | ObjectId | Filter by project |
| status | string | Filter by status |
| assignedTo | ObjectId | Filter by assigned user |
| source | string | Filter by source |
| priority | string | Filter by priority |
| minScore | number | Minimum score |
| maxScore | number | Maximum score |
| search | string | Search by name/phone/email |
| page | number | Page number |
| limit | number | Items per page |

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "firstName": "Rahul",
      "lastName": "Sharma",
      "phone": "+91-9876543210",
      "email": "rahul@example.com",
      "source": "Website",
      "status": "Qualified",
      "score": 78,
      "scoreGrade": "B+",
      "priority": "High",
      "budget": {
        "min": 5000000,
        "max": 8000000
      },
      "assignedTo": {
        "_id": "507f1f77bcf86cd799439012",
        "firstName": "John",
        "lastName": "Doe"
      },
      "project": {
        "_id": "507f1f77bcf86cd799439013",
        "name": "Green Valley Residency"
      },
      "engagementMetrics": {
        "totalInteractions": 5,
        "lastInteractionDate": "2024-01-14T15:30:00.000Z"
      },
      "followUpSchedule": {
        "nextFollowUpDate": "2024-01-16T10:00:00.000Z",
        "followUpType": "call"
      }
    }
  ]
}
```

---

#### GET /api/leads/:id
**Description**: Get lead by ID with full details

---

#### PUT /api/leads/:id
**Description**: Update lead

---

#### DELETE /api/leads/:id
**Description**: Delete lead

---

#### POST /api/leads/:id/interactions
**Description**: Add interaction to lead

**Request Body**:
```json
{
  "type": "Call",
  "direction": "Outbound",
  "content": "Discussed 2BHK options in Tower A. Customer interested in floor 15-20.",
  "outcome": "Interested",
  "nextAction": "Schedule site visit",
  "scheduledAt": "2024-01-20T14:00:00.000Z"
}
```

**Interaction Types**: `Call`, `Email`, `SMS`, `Meeting`, `Site Visit`, `WhatsApp`, `Note`

**Direction**: `Inbound`, `Outbound`

---

#### GET /api/leads/:id/interactions
**Description**: Get all interactions for a lead

---

#### GET /api/leads/:id/score
**Description**: Get detailed lead score breakdown

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "lead": {
      "_id": "507f1f77bcf86cd799439011",
      "firstName": "Rahul",
      "lastName": "Sharma"
    },
    "score": 78,
    "scoreGrade": "B+",
    "priority": "High",
    "confidence": 85,
    "scoreBreakdown": {
      "budgetAlignment": {
        "rawScore": 85,
        "weightedScore": 25.5,
        "reasoning": "Budget aligns well with available units",
        "alignmentPercentage": 85
      },
      "engagementLevel": {
        "rawScore": 80,
        "weightedScore": 24,
        "reasoning": "5 interactions in last 7 days shows high engagement",
        "interactionCount": 5
      },
      "timelineUrgency": {
        "rawScore": 70,
        "weightedScore": 14,
        "reasoning": "3-6 months timeline is moderate",
        "timeline": "3-6_months"
      },
      "sourceQuality": {
        "rawScore": 75,
        "weightedScore": 11.25,
        "reasoning": "Website leads have good conversion history",
        "source": "Website"
      },
      "recencyFactor": {
        "rawScore": 90,
        "weightedScore": 4.5,
        "reasoning": "Lead created recently",
        "ageInDays": 5
      }
    },
    "lastScoreUpdate": "2024-01-15T10:30:00.000Z"
  }
}
```

---

#### PUT /api/leads/:id/recalculate-score
**Description**: Recalculate lead score

---

#### GET /api/leads/high-priority
**Description**: Get high priority leads needing immediate attention

---

#### GET /api/leads/needs-attention
**Description**: Get leads needing follow-up or attention

---

#### GET /api/leads/simple-stats
**Description**: Get basic lead statistics

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "totalLeads": 150,
    "highPriorityLeads": 25,
    "qualifiedLeads": 45,
    "conversionRate": 30.00
  }
}
```

---

#### GET /api/leads/by-priority/:priority
**Description**: Get leads by priority level

**Priority Levels**: `Critical`, `High`, `Medium`, `Low`, `Very Low`

---

### 5.8 Sales APIs

#### POST /api/sales
**Description**: Create a new sale (book a unit)

**Access**: Private (Sales roles)

**Request Body**:
```json
{
  "project": "507f1f77bcf86cd799439011",
  "unit": "507f1f77bcf86cd799439012",
  "lead": "507f1f77bcf86cd799439013",
  "salePrice": 7500000,
  "discountAmount": 100000,
  "costSheetSnapshot": {
    "basePrice": 7000000,
    "gst": 350000,
    "stampDuty": 350000,
    "registrationFee": 70000,
    "parkingCharges": 300000,
    "clubMembership": 100000,
    "totalAmount": 8170000
  },
  "paymentPlanSnapshot": {
    "templateId": "507f1f77bcf86cd799439014",
    "templateName": "Construction Linked Plan",
    "schedule": [
      {
        "installmentNumber": 1,
        "description": "Booking Amount",
        "percentage": 10,
        "dueAfterDays": 0
      },
      {
        "installmentNumber": 2,
        "description": "On Agreement",
        "percentage": 20,
        "dueAfterDays": 30
      }
    ]
  },
  "channelPartner": "507f1f77bcf86cd799439015",
  "commission": {
    "rate": 2,
    "amount": 150000
  }
}
```

**Response (201)**:
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "saleNumber": "SAL-439011",
    "project": {...},
    "unit": {...},
    "lead": {...},
    "salePrice": 7500000,
    "status": "Booked",
    "bookingDate": "2024-01-15T10:30:00.000Z",
    "paymentPlan": "507f1f77bcf86cd799439016"
  }
}
```

---

#### GET /api/sales
**Description**: Get all sales

**Access**: Private (Management/Finance roles)

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| project | ObjectId | Filter by project |
| status | string | Filter by status |
| salesPerson | ObjectId | Filter by salesperson |
| startDate | date | Start date range |
| endDate | date | End date range |
| page | number | Page number |
| limit | number | Items per page |

**Sale Status**: `Booked`, `Agreement Signed`, `Registered`, `Completed`, `Cancelled`

---

#### GET /api/sales/:id
**Description**: Get sale by ID

---

#### PUT /api/sales/:id
**Description**: Update sale

---

#### DELETE /api/sales/:id
**Description**: Cancel sale

**Access**: Private (Senior management only)

---

#### PUT /api/sales/:id/cancel
**Description**: Cancel a sale (alternative endpoint)

---

#### GET /api/sales/analytics
**Description**: Get sales analytics

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalSales": 45,
      "totalRevenue": 337500000,
      "averageSaleValue": 7500000,
      "thisMonth": {
        "sales": 8,
        "revenue": 60000000
      }
    },
    "byProject": [
      {
        "project": "Green Valley Residency",
        "sales": 25,
        "revenue": 187500000
      }
    ],
    "byStatus": {
      "Booked": 20,
      "Agreement Signed": 15,
      "Registered": 8,
      "Completed": 2
    },
    "trends": {
      "monthly": [...]
    }
  }
}
```

---

#### GET /api/sales/pipeline
**Description**: Get sales pipeline data

---

### 5.9 Payment APIs

#### POST /api/payments/plans
**Description**: Create a new payment plan for a sale

**Access**: Private (Sales/Finance roles)

**Request Body**:
```json
{
  "sale": "507f1f77bcf86cd799439011",
  "planType": "construction_linked",
  "totalAmount": 8170000,
  "baseAmount": 7500000,
  "amountBreakdown": {
    "basePrice": 7000000,
    "taxes": {
      "gst": 350000,
      "stampDuty": 350000,
      "registrationFees": 70000
    },
    "additionalCharges": {
      "parkingCharges": 300000,
      "clubMembership": 100000
    },
    "discounts": {
      "negotiatedDiscount": 100000
    }
  },
  "installments": [
    {
      "installmentNumber": 1,
      "description": "Booking Amount",
      "percentage": 10,
      "dueAfterDays": 0,
      "milestoneType": "booking"
    },
    {
      "installmentNumber": 2,
      "description": "On Agreement",
      "percentage": 20,
      "dueAfterDays": 30,
      "milestoneType": "time_based"
    }
  ]
}
```

**Plan Types**: `construction_linked`, `time_based`, `milestone_based`, `custom`

---

#### GET /api/payments/plans/:saleId
**Description**: Get payment plan details for a sale

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "sale": {...},
    "customer": {...},
    "planType": "construction_linked",
    "totalAmount": 8170000,
    "financialSummary": {
      "totalPaid": 2451000,
      "totalOutstanding": 5719000,
      "totalOverdue": 817000,
      "totalLateFees": 8170,
      "nextDueAmount": 1634000,
      "nextDueDate": "2024-02-15T00:00:00.000Z"
    },
    "completionPercentage": 30,
    "installments": [...]
  }
}
```

---

#### PUT /api/payments/plans/:planId
**Description**: Update payment plan

---

#### GET /api/payments/installments/:planId
**Description**: Get all installments for a payment plan

---

#### PUT /api/payments/installments/:installmentId
**Description**: Update installment

---

#### POST /api/payments/installments/:installmentId/waive
**Description**: Waive an installment

**Access**: Private (Senior management)

---

#### POST /api/payments/transactions
**Description**: Record a payment transaction

**Access**: Private (Sales/Finance roles)

**Request Body**:
```json
{
  "paymentPlan": "507f1f77bcf86cd799439011",
  "amount": 817000,
  "paymentDate": "2024-01-15",
  "paymentMethod": "bank_transfer",
  "paymentMethodDetails": {
    "referenceNumber": "NEFT123456789",
    "transactionId": "TXN2024011500123"
  },
  "notes": "Booking amount received"
}
```

**Payment Methods**: `cash`, `cheque`, `bank_transfer`, `online_payment`, `card_payment`, `demand_draft`, `home_loan`

---

#### GET /api/payments/transactions/:planId
**Description**: Get payment transactions for a plan

---

#### PUT /api/payments/transactions/:transactionId
**Description**: Update payment transaction amount

---

#### POST /api/payments/transactions/:transactionId/verify
**Description**: Verify a payment transaction

---

#### GET /api/payments/reports/overdue
**Description**: Get overdue payments report

---

#### GET /api/payments/reports/due-today
**Description**: Get payments due today

---

#### GET /api/payments/reports/statistics
**Description**: Get payment statistics

---

### 5.10 Invoice APIs

#### POST /api/invoices/from-sale/:saleId
**Description**: Create invoice from a sale

**Access**: Private (Sales/Finance roles)

**Request Body**:
```json
{
  "type": "booking_invoice",
  "dueDate": "2024-02-15",
  "notes": {
    "customerNotes": "Please pay by due date to avail early bird discount",
    "paymentInstructions": "Bank details: ABC Bank, A/C: 123456789"
  }
}
```

**Invoice Types**: `booking_invoice`, `milestone_invoice`, `final_invoice`, `adjustment_invoice`, `cancellation_invoice`, `additional_charges`

---

#### GET /api/invoices
**Description**: Get all invoices

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status |
| project | ObjectId | Filter by project |
| customer | ObjectId | Filter by customer |
| startDate | date | Invoice date start |
| endDate | date | Invoice date end |

**Invoice Status**: `draft`, `generated`, `sent`, `paid`, `overdue`, `cancelled`, `partially_paid`

---

#### GET /api/invoices/:id
**Description**: Get invoice by ID

---

#### PUT /api/invoices/:id
**Description**: Update invoice

---

#### POST /api/invoices/:id/payment
**Description**: Record payment for invoice

**Request Body**:
```json
{
  "amount": 817000,
  "paymentMethod": "bank_transfer",
  "paymentReference": "NEFT123456789",
  "paymentDate": "2024-01-15"
}
```

---

#### PUT /api/invoices/:id/cancel
**Description**: Cancel invoice

---

#### GET /api/invoices/statistics
**Description**: Get invoice statistics

---

#### GET /api/invoices/overdue
**Description**: Get overdue invoices

---

#### GET /api/invoices/export
**Description**: Export invoices to CSV

---

### 5.11 Commission APIs

#### POST /api/commissions/structures
**Description**: Create commission structure

**Access**: Private (Management roles)

**Request Body**:
```json
{
  "structureName": "Standard Partner Commission",
  "description": "Standard commission for channel partners",
  "project": "507f1f77bcf86cd799439011",
  "calculationMethod": "percentage",
  "baseCommissionRate": 2,
  "calculationBasis": "sale_price",
  "unitTypeRates": [
    { "unitType": "1BHK", "commissionRate": 1.5, "flatAmount": 0 },
    { "unitType": "2BHK", "commissionRate": 2, "flatAmount": 0 },
    { "unitType": "3BHK", "commissionRate": 2.5, "flatAmount": 0 }
  ],
  "paymentTerms": {
    "paymentSchedule": "monthly",
    "paymentDelay": 30
  },
  "taxSettings": {
    "tdsApplicable": true,
    "tdsRate": 5
  },
  "validityPeriod": {
    "startDate": "2024-01-01",
    "endDate": "2024-12-31",
    "isActive": true
  }
}
```

**Calculation Methods**: `percentage`, `flat_rate`, `tiered`, `hybrid`

---

#### GET /api/commissions/structures
**Description**: Get all commission structures

---

#### GET /api/commissions/structures/:id
**Description**: Get commission structure by ID

---

#### PUT /api/commissions/structures/:id
**Description**: Update commission structure

---

#### DELETE /api/commissions/structures/:id
**Description**: Deactivate commission structure

---

#### POST /api/commissions/create-for-sale
**Description**: Create commission for a sale

**Request Body**:
```json
{
  "sale": "507f1f77bcf86cd799439011",
  "partner": "507f1f77bcf86cd799439012",
  "commissionStructure": "507f1f77bcf86cd799439013"
}
```

---

#### GET /api/commissions
**Description**: Get commissions with filters

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status |
| partner | ObjectId | Filter by partner |
| project | ObjectId | Filter by project |
| startDate | date | Date range start |
| endDate | date | Date range end |

---

#### GET /api/commissions/:id
**Description**: Get commission by ID

---

#### POST /api/commissions/:id/approve
**Description**: Approve commission

---

#### POST /api/commissions/:id/reject
**Description**: Reject commission

---

#### POST /api/commissions/:id/hold
**Description**: Put commission on hold

---

#### POST /api/commissions/:id/release
**Description**: Release commission from hold

---

#### POST /api/commissions/:id/payment
**Description**: Record commission payment

---

#### GET /api/commissions/analytics
**Description**: Get commission analytics

---

#### GET /api/commissions/reports/overdue
**Description**: Get overdue commissions

---

### 5.12 Document APIs

#### POST /api/documents/categories
**Description**: Create document category

**Request Body**:
```json
{
  "name": "Sale Documents",
  "description": "Documents related to sales",
  "parentCategory": null
}
```

---

#### GET /api/documents/categories
**Description**: Get all document categories

---

#### GET /api/documents/categories/tree
**Description**: Get category tree structure

---

#### POST /api/documents/upload
**Description**: Upload a document

**Content-Type**: `multipart/form-data`

**Form Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | Document file (max 50MB) |
| category | ObjectId | No | Category ID |
| resourceType | string | No | Associated resource type |
| associatedResource | ObjectId | No | Associated resource ID |
| title | string | No | Document title |
| description | string | No | Document description |
| tags | string[] | No | Document tags |

**Allowed File Types**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV, JPEG, PNG, GIF, WebP, MP4, MOV, AVI, ZIP, RAR

---

#### GET /api/documents
**Description**: Get documents with filtering

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| category | ObjectId | Filter by category |
| resourceType | string | Filter by resource type |
| associatedResource | ObjectId | Filter by associated resource |
| search | string | Search documents |
| page | number | Page number |
| limit | number | Items per page |

---

#### GET /api/documents/:id
**Description**: Get document by ID

---

#### PUT /api/documents/:id
**Description**: Update document metadata

---

#### DELETE /api/documents/:id
**Description**: Delete document

---

### 5.13 Construction APIs

#### POST /api/construction/milestones
**Description**: Create construction milestone

**Access**: Private (Management roles)

**Request Body**:
```json
{
  "project": "507f1f77bcf86cd799439011",
  "name": "Foundation Work",
  "description": "Complete foundation for Tower A",
  "type": "Foundation",
  "category": "Civil Work",
  "phase": "Foundation Phase",
  "plannedStartDate": "2024-02-01",
  "plannedEndDate": "2024-04-30",
  "priority": "High",
  "budget": {
    "plannedCost": 5000000,
    "currency": "INR"
  },
  "assignedTo": "507f1f77bcf86cd799439012"
}
```

**Milestone Types**: `Planning`, `Foundation`, `Structure`, `Roofing`, `Plumbing`, `Electrical`, `Flooring`, `Walls`, `Finishing`, `Inspection`, `Handover`, `Other`

**Phases**: `Pre-Construction`, `Foundation Phase`, `Structure Phase`, `MEP Phase`, `Finishing Phase`, `Inspection Phase`, `Handover Phase`

**Status**: `Not Started`, `Planning`, `In Progress`, `On Hold`, `Completed`, `Delayed`, `Cancelled`

---

#### GET /api/construction/milestones
**Description**: Get milestones

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| project | ObjectId | Filter by project |
| status | string | Filter by status |
| phase | string | Filter by phase |

---

#### GET /api/construction/milestones/:id
**Description**: Get milestone by ID

---

#### PUT /api/construction/milestones/:id
**Description**: Update milestone

---

#### PUT /api/construction/milestones/:id/progress
**Description**: Update milestone progress

**Request Body**:
```json
{
  "percentage": 75,
  "notes": "Concrete pouring completed for basement"
}
```

---

#### POST /api/construction/milestones/:id/quality-checks
**Description**: Add quality check

**Request Body**:
```json
{
  "checkName": "Concrete Strength Test",
  "description": "28-day concrete cube test",
  "isRequired": true,
  "status": "Pending"
}
```

---

#### PUT /api/construction/milestones/:id/quality-checks/:checkId
**Description**: Update quality check status

**Request Body**:
```json
{
  "status": "Passed",
  "notes": "Concrete strength 32 MPa - within specifications"
}
```

---

#### POST /api/construction/milestones/:id/issues
**Description**: Add issue to milestone

**Request Body**:
```json
{
  "issueType": "Quality",
  "severity": "Medium",
  "title": "Minor crack in basement wall",
  "description": "Hairline crack observed in northwest corner"
}
```

---

#### POST /api/construction/milestones/:id/photos
**Description**: Upload progress photos

**Content-Type**: `multipart/form-data`

**Form Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| photos | File[] | Yes | Image files (max 10, 10MB each) |

**Allowed Types**: JPEG, PNG, GIF, WebP

---

#### GET /api/construction/projects/:projectId/timeline
**Description**: Get project construction timeline

---

#### GET /api/construction/milestones/overdue
**Description**: Get overdue milestones

---

#### GET /api/construction/analytics
**Description**: Get construction analytics

---

### 5.14 Contractor APIs

#### POST /api/contractors
**Description**: Create contractor

**Access**: Private (Management roles)

**Request Body**:
```json
{
  "name": "ABC Construction",
  "contactPerson": "Rajesh Kumar",
  "email": "rajesh@abcconstruction.com",
  "phone": "+91-9876543210",
  "specializations": ["Civil Work", "Foundation", "Structure"],
  "address": {
    "street": "123 Industrial Area",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001"
  },
  "experience": 15,
  "licenseNumber": "CON-MH-2024-12345",
  "taxId": "ABCDE1234F"
}
```

---

#### GET /api/contractors
**Description**: Get all contractors

---

#### GET /api/contractors/available
**Description**: Get available contractors

---

#### GET /api/contractors/by-specialization/:specialization
**Description**: Get contractors by specialization

---

#### GET /api/contractors/:id
**Description**: Get contractor by ID

---

#### PUT /api/contractors/:id
**Description**: Update contractor

---

#### POST /api/contractors/:id/reviews
**Description**: Add contractor review

**Request Body**:
```json
{
  "rating": 4,
  "review": "Good quality work, completed on time",
  "project": "507f1f77bcf86cd799439011"
}
```

---

#### PUT /api/contractors/:id/status
**Description**: Update contractor status

---

#### PUT /api/contractors/:id/preferred
**Description**: Toggle preferred status

---

### 5.15 Analytics APIs

#### GET /api/analytics/dashboard
**Description**: Get comprehensive dashboard analytics

**Access**: Private (Management roles)

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalProjects": 5,
      "totalUnits": 1000,
      "soldUnits": 250,
      "availableUnits": 750,
      "totalLeads": 500,
      "qualifiedLeads": 150
    },
    "revenue": {
      "target": 7500000000,
      "achieved": 1875000000,
      "percentage": 25
    },
    "salesTrend": [...],
    "leadConversion": {...},
    "projectWise": [...]
  }
}
```

---

#### GET /api/analytics/sales-summary
**Description**: Get high-level sales summary

---

#### GET /api/analytics/lead-funnel
**Description**: Get lead funnel analysis

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "funnel": [
      { "stage": "New", "count": 200, "percentage": 100 },
      { "stage": "Contacted", "count": 150, "percentage": 75 },
      { "stage": "Qualified", "count": 100, "percentage": 50 },
      { "stage": "Site Visit", "count": 60, "percentage": 30 },
      { "stage": "Negotiating", "count": 30, "percentage": 15 },
      { "stage": "Booked", "count": 20, "percentage": 10 }
    ],
    "conversionRates": {
      "newToContacted": 75,
      "contactedToQualified": 66.67,
      "qualifiedToSiteVisit": 60,
      "siteVisitToNegotiating": 50,
      "negotiatingToBooked": 66.67,
      "overallConversion": 10
    }
  }
}
```

---

#### GET /api/analytics/sales-report
**Description**: Get detailed sales report

---

#### GET /api/analytics/budget-vs-actual
**Description**: Get budget vs actual report

---

#### GET /api/analytics/budget-dashboard
**Description**: Get budget dashboard summary

---

#### GET /api/analytics/revenue-analysis
**Description**: Get revenue analysis

---

#### GET /api/analytics/sales-analysis
**Description**: Get sales performance analysis

---

#### GET /api/analytics/lead-analysis
**Description**: Get lead generation analysis

---

#### GET /api/analytics/project-comparison
**Description**: Get project-wise comparison

---

#### GET /api/analytics/marketing-roi
**Description**: Get marketing ROI analysis

---

### 5.16 AI APIs

#### GET /api/ai/leads/:id/insights
**Description**: Get AI-powered insights for a lead

**Access**: Private (Sales roles)

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "lead": {
      "_id": "507f1f77bcf86cd799439011",
      "firstName": "Rahul",
      "lastName": "Sharma"
    },
    "insights": {
      "buyingMotivators": [
        "Investment opportunity for retirement",
        "Proximity to workplace",
        "School admission for children"
      ],
      "potentialObjections": [
        "Budget concerns around additional charges",
        "Possession timeline uncertainty",
        "Comparison with competitor projects"
      ],
      "openingLines": [
        "Rahul, I noticed you were particularly interested in east-facing units...",
        "Based on your requirement for a 2BHK, I have some exciting options..."
      ],
      "strategicQuestions": [
        "What's driving your timeline of 3-6 months?",
        "Have you finalized your loan pre-approval?",
        "Would you like to visit the site this weekend?"
      ],
      "recommendedApproach": "Focus on investment potential and ROI projections. Address possession timeline concerns upfront with construction progress updates.",
      "urgencyLevel": "Medium-High",
      "conversionProbability": 65
    }
  }
}
```

---

#### POST /api/ai/conversation/analyze
**Description**: Analyze conversation text with AI

**Request Body**:
```json
{
  "conversationText": "Customer: I'm interested in the 2BHK but the price seems high compared to other projects...",
  "leadId": "507f1f77bcf86cd799439011"
}
```

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "sentiment": {
      "overall": "mixed",
      "confidence": 0.78,
      "breakdown": {
        "positive": 0.35,
        "negative": 0.25,
        "neutral": 0.40
      }
    },
    "buyingSignals": [
      { "signal": "Expressed interest in specific unit type", "strength": "strong" },
      { "signal": "Comparing with competitors", "strength": "moderate" }
    ],
    "objections": [
      { "objection": "Price concern", "severity": "medium", "suggestedResponse": "..." }
    ],
    "leadTemperature": "warm",
    "conversionProbability": 55,
    "keyTopics": ["pricing", "unit configuration", "location"],
    "actionItems": [
      "Send competitive analysis",
      "Schedule site visit",
      "Prepare cost breakdown"
    ]
  }
}
```

---

#### POST /api/ai/conversation/recommendations
**Description**: Get follow-up recommendations

**Request Body**:
```json
{
  "leadId": "507f1f77bcf86cd799439011",
  "recentInteractions": [...]
}
```

---

#### GET /api/ai/conversation/leads/:id/interaction-patterns
**Description**: Analyze interaction patterns for a lead

---

#### GET /api/ai/conversation/leads/:id/conversation-summary
**Description**: Get conversation summary for a lead

---

### Predictive Analytics APIs

#### GET /api/analytics/predictions/sales-forecast
**Description**: Get sales forecast

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| projectId | ObjectId | Filter by project (optional) |
| period | string | `3_months`, `6_months`, `12_months` |
| format | string | `summary`, `detailed`, `chart` |

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "forecast": {
      "period": "6_months",
      "totalForecastedSales": 45,
      "totalForecastedRevenue": 337500000,
      "monthlyBreakdown": [
        { "month": "2024-02", "sales": 8, "revenue": 60000000 },
        { "month": "2024-03", "sales": 7, "revenue": 52500000 }
      ],
      "confidenceInterval": {
        "lower": 280000000,
        "upper": 395000000,
        "confidence": 0.85
      }
    },
    "scenarios": {
      "pessimistic": { "sales": 35, "revenue": 262500000 },
      "realistic": { "sales": 45, "revenue": 337500000 },
      "optimistic": { "sales": 55, "revenue": 412500000 }
    },
    "dataQuality": "High"
  }
}
```

---

#### GET /api/analytics/predictions/revenue-projection
**Description**: Get revenue projection

---

#### GET /api/analytics/predictions/lead-conversion-probability
**Description**: Get lead conversion predictions

---

#### GET /api/analytics/predictions/inventory-turnover
**Description**: Get inventory turnover predictions

---

### 5.17 Pricing APIs

#### POST /api/pricing/cost-sheet/:unitId
**Description**: Generate cost sheet for a unit

**Access**: Private (Sales roles)

**Request Body**:
```json
{
  "discounts": {
    "negotiatedDiscount": 100000,
    "earlyBirdDiscount": 50000
  },
  "includeStampDuty": true,
  "includeRegistrationFee": true,
  "paymentPlanId": "507f1f77bcf86cd799439011"
}
```

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "unit": {
      "_id": "507f1f77bcf86cd799439011",
      "unitNumber": "A-101",
      "type": "2BHK"
    },
    "costSheet": {
      "basePrice": 7000000,
      "pricePerSqft": 5833.33,
      "additionalCharges": {
        "floorRiseCharge": 125000,
        "plcCharges": {
          "parkFacing": 100000
        },
        "parkingCharges": 300000,
        "clubMembership": 100000,
        "maintenanceDeposit": 150000,
        "legalCharges": 50000
      },
      "subtotal": 7825000,
      "taxes": {
        "gst": 391250,
        "stampDuty": 350000,
        "registrationFee": 70000
      },
      "discounts": {
        "negotiatedDiscount": 100000,
        "earlyBirdDiscount": 50000
      },
      "grandTotal": 8486250
    },
    "paymentSchedule": [...]
  }
}
```

---

#### GET /api/pricing/dynamic/:projectId
**Description**: Get dynamic pricing suggestions

**Access**: Private (Management roles)

---

### 5.18 File Upload APIs

#### POST /api/files/upload
**Description**: Upload a file

**Content-Type**: `multipart/form-data`

**Form Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | File to upload (max 10MB) |
| resourceId | ObjectId | No | Associated resource ID |
| resourceType | string | No | Resource type (lead, project, sale, etc.) |

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "fileName": "document.pdf",
    "fileUrl": "https://s3.amazonaws.com/...",
    "mimeType": "application/pdf",
    "size": 1024000
  }
}
```

---

#### GET /api/files/resource/:resourceId
**Description**: Get files for a resource

---

### Project Payment Configuration APIs

#### GET /api/projects/:projectId/payment-config
**Description**: Get payment configuration for a project

---

#### PUT /api/projects/:projectId/payment-config
**Description**: Update payment configuration

---

#### GET /api/projects/:projectId/payment-templates
**Description**: Get payment plan templates

---

#### POST /api/projects/:projectId/payment-templates
**Description**: Create payment plan template

**Request Body**:
```json
{
  "name": "Construction Linked Plan",
  "description": "Payment linked to construction milestones",
  "planType": "construction_linked",
  "installments": [
    {
      "installmentNumber": 1,
      "description": "Booking Amount",
      "percentage": 10,
      "dueAfterDays": 0,
      "milestoneType": "booking"
    },
    {
      "installmentNumber": 2,
      "description": "On Agreement",
      "percentage": 20,
      "dueAfterDays": 30,
      "milestoneType": "time_based"
    },
    {
      "installmentNumber": 3,
      "description": "On Foundation",
      "percentage": 15,
      "milestoneType": "construction",
      "milestoneDescription": "Foundation completion"
    }
  ],
  "gracePeriodDays": 7,
  "lateFeeRate": 2
}
```

---

#### PUT /api/projects/:projectId/payment-templates/:templateId
**Description**: Update payment template

---

#### DELETE /api/projects/:projectId/payment-templates/:templateId
**Description**: Deactivate payment template

---

#### POST /api/projects/:projectId/calculate-charges
**Description**: Calculate charges for a unit price

**Request Body**:
```json
{
  "unitPrice": 7000000,
  "includeStampDuty": true,
  "includeRegistrationFee": true,
  "discounts": {
    "negotiatedDiscount": 100000
  }
}
```

---

## 6. Data Models & Schemas

### 6.1 User Schema

```typescript
interface User {
  _id: ObjectId;
  organization: ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLogin: Date;
  phoneNumber?: string;
  profileImage?: string;
  invitationStatus: 'pending' | 'accepted' | 'expired' | 'revoked';
  invitedBy?: ObjectId;
  invitedAt?: Date;
  acceptedAt?: Date;
  preferences: {
    language: 'en' | 'hi';
    timezone: string;
    notifications: {
      email: boolean;
      push: boolean;
      sms: boolean;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

type UserRole =
  | 'Business Head'
  | 'Sales Head'
  | 'Marketing Head'
  | 'Finance Head'
  | 'Project Director'
  | 'Sales Manager'
  | 'Finance Manager'
  | 'Channel Partner Manager'
  | 'Sales Executive'
  | 'Channel Partner Admin'
  | 'Channel Partner Agent';
```

### 6.2 Organization Schema

```typescript
interface Organization {
  _id: ObjectId;
  name: string;
  type: 'builder' | 'channel_partner';
  country: string;
  city: string;
  contactInfo?: {
    phone?: string;
    website?: string;
    address?: string;
  };
  subscriptionPlan: 'trial' | 'starter' | 'professional' | 'enterprise';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.3 Project Schema

```typescript
interface Project {
  _id: ObjectId;
  organization: ObjectId;
  name: string;
  description?: string;
  type: 'apartment' | 'villa' | 'plot' | 'commercial';
  status: ProjectStatus;
  location: {
    city: string;
    area: string;
    pincode?: string;
    state?: string;
    landmark?: string;
  };
  totalUnits: number;
  totalArea?: number;
  priceRange: {
    min: number;
    max: number;
  };
  targetRevenue: number;
  launchDate?: Date;
  expectedCompletionDate?: Date;
  amenities: string[];
  approvals?: {
    rera?: { number: string; date: Date; validUntil: Date };
    environmentClearance?: { number: string; date: Date };
    buildingPlan?: { number: string; date: Date };
  };
  pricingRules?: {
    gstRate: number;
    tdsRate: number;
    floorRiseCharge: number;
    plcCharges: {
      parkFacing: number;
      cornerUnit: number;
      seaFacing: number;
      roadFacing: number;
    };
  };
  paymentConfiguration?: PaymentConfiguration;
  budgetTracking?: BudgetTracking;
  createdAt: Date;
  updatedAt: Date;
}

type ProjectStatus = 'planning' | 'pre-launch' | 'launched' | 'under-construction' | 'completed' | 'on-hold';
```

### 6.4 Lead Schema

```typescript
interface Lead {
  _id: ObjectId;
  organization: ObjectId;
  project: ObjectId;
  assignedTo?: ObjectId;
  firstName: string;
  lastName?: string;
  email?: string;
  phone: string;
  source: LeadSource;
  status: LeadStatus;
  score: number;
  scoreGrade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D';
  priority: 'Critical' | 'High' | 'Medium' | 'Low' | 'Very Low';
  confidence: number;
  budget?: {
    min?: number;
    max?: number;
    isValidated?: boolean;
    budgetSource?: 'self_reported' | 'pre_approved' | 'loan_approved' | 'verified';
  };
  requirements?: {
    timeline?: 'immediate' | '1-3_months' | '3-6_months' | '6-12_months' | '12+_months';
    unitType?: string;
    floor?: { preference: 'low' | 'medium' | 'high' | 'any'; specific?: number };
    facing?: string;
    amenities?: string[];
  };
  qualificationStatus: 'Not Qualified' | 'In Progress' | 'Qualified' | 'Pre-Approved';
  engagementMetrics: {
    totalInteractions: number;
    lastInteractionDate?: Date;
    lastInteractionType?: string;
    responseRate: number;
  };
  followUpSchedule?: {
    nextFollowUpDate?: Date;
    followUpType?: 'call' | 'email' | 'site_visit' | 'meeting' | 'whatsapp';
    notes?: string;
    isOverdue?: boolean;
  };
  scoreBreakdown?: ScoreBreakdown;
  notes?: string;
  lastScoreUpdate: Date;
  createdAt: Date;
  updatedAt: Date;
}

type LeadSource = 'Website' | 'Property Portal' | 'Referral' | 'Walk-in' | 'Social Media' | 'Advertisement' | 'Cold Call' | 'Other';
type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Site Visit Scheduled' | 'Site Visit Completed' | 'Negotiating' | 'Booked' | 'Lost' | 'Unqualified';
```

### 6.5 Unit Schema

```typescript
interface Unit {
  _id: ObjectId;
  project: ObjectId;
  tower?: ObjectId;
  organization: ObjectId;
  unitNumber: string;
  type: string;
  floor: number;
  areaSqft: number;
  basePrice: number;
  currentPrice: number;
  facing?: 'North' | 'South' | 'East' | 'West' | 'North-East' | 'North-West' | 'South-East' | 'South-West';
  status: 'available' | 'booked' | 'sold' | 'blocked';
  features?: {
    isParkFacing?: boolean;
    isCornerUnit?: boolean;
    hasBalcony?: boolean;
    hasServantRoom?: boolean;
    hasParkingSlot?: boolean;
  };
  specifications?: {
    bedrooms?: number;
    bathrooms?: number;
    livingRooms?: number;
    kitchen?: number;
    balconies?: number;
    carpetArea?: number;
    builtUpArea?: number;
    superBuiltUpArea?: number;
  };
  parking?: {
    covered?: number;
    open?: number;
    parkingNumbers?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.6 Sale Schema

```typescript
interface Sale {
  _id: ObjectId;
  project: ObjectId;
  unit: ObjectId;
  lead: ObjectId;
  organization: ObjectId;
  salesPerson: ObjectId;
  channelPartner?: ObjectId;
  paymentPlan?: ObjectId;
  salePrice: number;
  discountAmount?: number;
  costSheetSnapshot: object;
  paymentPlanSnapshot?: object;
  bookingDate: Date;
  status: 'Booked' | 'Agreement Signed' | 'Registered' | 'Completed' | 'Cancelled';
  commission?: {
    rate?: number;
    amount?: number;
  };
  cancellationReason?: string;
  cancelledBy?: ObjectId;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Virtual
  saleNumber: string;
}
```

### 6.7 Interaction Schema

```typescript
interface Interaction {
  _id: ObjectId;
  lead: ObjectId;
  user: ObjectId;
  organization: ObjectId;
  type: 'Call' | 'Email' | 'SMS' | 'Meeting' | 'Site Visit' | 'WhatsApp' | 'Note';
  direction?: 'Inbound' | 'Outbound';
  content: string;
  outcome?: string;
  nextAction?: string;
  scheduledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.8 Invoice Schema

```typescript
interface Invoice {
  _id: ObjectId;
  invoiceNumber: string;
  sequenceNumber: number;
  financialYear: string;
  organization: ObjectId;
  sale: ObjectId;
  project: ObjectId;
  unit: ObjectId;
  customer: ObjectId;
  generatedBy: ObjectId;
  type: InvoiceType;
  status: InvoiceStatus;
  invoiceDate: Date;
  dueDate: Date;
  lineItems: LineItem[];
  financialSummary: {
    subtotal: number;
    discountAmount: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalGstAmount: number;
    totalAmount: number;
    amountInWords?: string;
  };
  paymentDetails: {
    totalPaid: number;
    pendingAmount: number;
    lastPaymentDate?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

type InvoiceType = 'booking_invoice' | 'milestone_invoice' | 'final_invoice' | 'adjustment_invoice' | 'cancellation_invoice' | 'additional_charges';
type InvoiceStatus = 'draft' | 'generated' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'partially_paid';
```

---

## 7. Business Flows

### 7.1 User Onboarding Flow

```
1. Organization Registration (POST /api/auth/register)
   └── Creates Organization + Business Head user
   └── Returns JWT token

2. Business Head invites team members (POST /api/invitations/generate)
   └── System creates user record with pending status
   └── Returns invitation link with token

3. Invited user opens link
   └── Frontend calls GET /api/invitations/verify/:userId
   └── Displays invitation acceptance form

4. User accepts invitation (POST /api/invitations/accept/:userId)
   └── User sets password
   └── Account activated
   └── Returns JWT token
```

### 7.2 Lead to Sale Conversion Flow

```
1. Lead Creation (POST /api/leads)
   └── Auto-calculates initial score
   └── Assigns priority

2. Lead Nurturing
   └── Add interactions (POST /api/leads/:id/interactions)
   └── Score recalculates automatically
   └── Get AI insights (GET /api/ai/leads/:id/insights)

3. Site Visit & Negotiation
   └── Update lead status
   └── Generate cost sheet (POST /api/pricing/cost-sheet/:unitId)

4. Booking
   └── Create sale (POST /api/sales)
   └── Unit status → 'booked'
   └── Lead status → 'Booked'
   └── Payment plan created automatically

5. Payment Collection
   └── Record payments (POST /api/payments/transactions)
   └── Generate invoices (POST /api/invoices/from-sale/:saleId)

6. Registration & Handover
   └── Update sale status
   └── Unit status → 'sold'
```

### 7.3 Payment Collection Flow

```
1. Sale Created
   └── Payment plan auto-created from template
   └── Installments generated with due dates

2. Payment Received
   └── Record transaction (POST /api/payments/transactions)
   └── Allocate to installments
   └── Update financial summary

3. Invoice Generation
   └── Create invoice for payment (POST /api/invoices/from-sale/:saleId)
   └── Send to customer

4. Overdue Management
   └── System tracks overdue payments
   └── Late fees calculated automatically
   └── Reports available (GET /api/payments/reports/overdue)
```

### 7.4 Commission Flow

```
1. Define Commission Structure
   └── POST /api/commissions/structures

2. Sale with Channel Partner
   └── Include channelPartner in sale creation

3. Commission Calculation
   └── POST /api/commissions/create-for-sale
   └── System calculates based on structure

4. Commission Approval
   └── POST /api/commissions/:id/approve

5. Commission Payment
   └── POST /api/commissions/:id/payment
```

---

## 8. Error Handling

### HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET, PUT |
| 201 | Created | Successful POST |
| 400 | Bad Request | Invalid input, validation error |
| 401 | Unauthorized | Missing or invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate entry |
| 410 | Gone | Invitation expired |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |

### Error Response Format

```json
{
  "success": false,
  "message": "Human-readable error message",
  "code": "ERROR_CODE",
  "error": "Technical details (dev mode only)",
  "errors": ["Array of validation errors"]
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Input validation failed |
| `DUPLICATE_ENTRY` | Resource already exists |
| `NOT_FOUND` | Resource not found |
| `UNAUTHORIZED` | Authentication required |
| `FORBIDDEN` | Permission denied |
| `RATE_LIMITED` | Too many requests |
| `INVALID_TOKEN` | Invalid JWT or invitation token |
| `EXPIRED_INVITATION` | Invitation has expired |

---

## 9. Best Practices

### 9.1 Authentication

```javascript
// Store token after login
localStorage.setItem('token', response.data.token);

// Add to all requests
axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

// Handle 401 errors
axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      // Redirect to login
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### 9.2 Pagination

```javascript
// Request with pagination
const response = await axios.get('/api/leads', {
  params: {
    page: 1,
    limit: 20,
    status: 'New',
    sortBy: 'createdAt',
    sortOrder: 'desc'
  }
});

// Response structure
{
  "data": [...],
  "pagination": {
    "currentPage": 1,
    "totalPages": 10,
    "totalItems": 195,
    "limit": 20
  }
}
```

### 9.3 File Uploads

```javascript
// Using FormData
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('resourceType', 'lead');
formData.append('associatedResource', leadId);

const response = await axios.post('/api/documents/upload', formData, {
  headers: {
    'Content-Type': 'multipart/form-data'
  }
});
```

### 9.4 Real-time Updates (Polling)

```javascript
// Poll for updates every 30 seconds
const pollDashboard = () => {
  setInterval(async () => {
    const response = await axios.get('/api/analytics/dashboard');
    updateDashboard(response.data);
  }, 30000);
};
```

### 9.5 Error Display

```javascript
// Centralized error handling
const handleApiError = (error) => {
  const message = error.response?.data?.message || 'An error occurred';
  const code = error.response?.data?.code;

  switch (code) {
    case 'VALIDATION_ERROR':
      showValidationErrors(error.response.data.errors);
      break;
    case 'RATE_LIMITED':
      showRateLimitWarning(error.response.data.retryAfter);
      break;
    default:
      showErrorToast(message);
  }
};
```

---

## Appendix: Health Check Endpoints

### GET /api/health
Returns server health status.

### GET /api/docs
Returns API documentation summary.

### GET /api/ai-features
Returns AI capabilities overview.

### GET /api/performance
Returns server performance metrics.

---

## Changelog

### Version 1.8.0
- Added predictive analytics APIs
- Enhanced AI conversation analysis
- Added budget variance tracking
- Improved invoice management
- Added bulk operations support

---

**Document Version**: 1.0.0
**Last Updated**: 2024-01-15
**API Version**: 1.8.0

For questions or support, contact the backend team or raise an issue in the repository.
