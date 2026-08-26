# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app

# Install root dependencies
COPY package.json package-lock.json ./
# Install frontend dependencies (frontend has its own lockfile)
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci
RUN npm --prefix frontend ci

# Copy the rest of the source and build the frontend
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Install all dependencies (including tsx, used to run the backend).
# NODE_ENV=production above would make npm omit dev deps, so force them in.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy the backend source, shared code, and the built frontend
COPY --from=build /app/backend ./backend
COPY --from=build /app/shared ./shared
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/frontend/dist ./frontend/dist

ENV PORT=3001
EXPOSE 3001
USER node
CMD ["npm", "run", "serve"]
