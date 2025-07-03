PropVantage AI - Backend API
This repository contains the backend source code for PropVantage AI, a comprehensive, AI-powered CRM platform for the real estate industry. The API is built with Node.js, Express, and MongoDB, and is designed to be secure, scalable, and robust.

Features
Secure Authentication: JWT-based authentication for all users.

Role-Based Access Control (RBAC): Granular permissions for different user roles (e.g., Business Head, Sales Executive, Finance Manager).

Multi-Tenant Architecture: Data is strictly segregated by organization.

Project & Inventory Management: Full CRUD operations for projects and their associated units.

Lead & Pipeline Management: End-to-end lead tracking from creation to booking.

Advanced Financial Engine:

Cost Sheet Generator: Creates detailed, line-itemized cost sheets with support for GST, discounts, and other charges.

Dynamic Pricing Engine: AI-powered suggestions to optimize pricing for unsold inventory based on revenue targets.

Conversational AI Co-Pilot: OpenAI integration to provide sales insights, talking points, and objection handling for leads.

Containerized: Fully containerized with Docker for easy setup and deployment.

Prerequisites
Node.js (v18 or later)

npm

Docker

Postman (for API testing)

Local Development Setup
1. Clone the Repository
git clone <your-repo-url>
cd propvantage-ai-backend

2. Create Environment File
Create a .env file in the root of the project and add the following variables.

# Server Configuration
NODE_ENV=development
PORT=3000

# JSON Web Token Secret (use a long, random string)
JWT_SECRET=your-super-secret-jwt-key

# OpenAI API Key
OPENAI_API_KEY=your-openai-api-key-here

# MongoDB Connection String (Only needed for non-Docker setup)
# MONGO_URI=your-mongodb-atlas-connection-string

3. Running with Docker (Recommended)
This is the easiest way to get started, as it runs both the application and the database in isolated containers.

docker-compose up --build

The API will be available at http://localhost:3000.

The local MongoDB database will be running and accessible on port 27017.

Any changes you make to the source code will automatically restart the server.

To stop the services:

docker-compose down

4. Running without Docker (Manual Setup)
If you prefer not to use Docker, you can run the application directly.

# Install dependencies
npm install

# Make sure your .env file has a valid MONGO_URI for your local or cloud database

# Run the server with nodemon (for development)
npm run server

API Endpoints
A complete Postman collection (postman_collection.json) will be provided to test all available endpoints.

Base URL: http://localhost:3000

POST /api/auth/register - Register a new organization and admin user.

POST /api/auth/login - Login a user and receive a JWT.

GET /api/projects - Get all projects for the organization.

POST /api/leads - Create a new lead.

GET /api/ai/leads/:id/insights - Get AI-powered sales insights for a lead.

POST /api/pricing/cost-sheet/:unitId - Generate a detailed cost sheet for a unit.

GET /api/pricing/dynamic/:projectId - Get dynamic pricing suggestions for a project.

POST /api/sales - Book a new sale.

This concludes the 3-day development sprint. We have a fully functional, documented, and containerized backend ready for testing and deployment.