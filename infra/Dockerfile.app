FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

ARG APP_PACKAGE
ENV APP_PACKAGE=${APP_PACKAGE}

RUN pnpm install --frozen-lockfile

CMD ["sh", "-lc", "pnpm --filter ${APP_PACKAGE} start"]
