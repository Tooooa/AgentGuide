# Stage 1: Build
FROM node:18-alpine AS build

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
# Using npm set strict-ssl false in case of network issues in some envs, but generally straightforward install
RUN npm config set registry https://registry.npmmirror.com
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
