# Stage 1: Use an official Node.js runtime as a parent image
# Using the 'alpine' version for a smaller image size
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
# This leverages Docker's layer caching. These files don't change often.
COPY package*.json ./

# Install app dependencies
RUN npm ci --only=production

# Copy the rest of the application source code to the working directory
COPY . .

# The port that the application will run on inside the container
EXPOSE 3000

# The command to run the application
CMD ["node", "server.js"]
