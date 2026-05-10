FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
RUN set -eux; \
    PNPM_SPEC="$(node -p "require('./package.json').packageManager")"; \
    for attempt in 1 2 3; do \
      corepack prepare "${PNPM_SPEC}" --activate && break; \
      if [ "${attempt}" = "3" ]; then \
        exit 1; \
      fi; \
      sleep $((attempt * 5)); \
    done; \
    pnpm --version
COPY apps ./apps
COPY packages ./packages

ARG APP_PACKAGE
ENV APP_PACKAGE=${APP_PACKAGE}

RUN pnpm install --frozen-lockfile

CMD ["sh", "-lc", "pnpm --filter ${APP_PACKAGE} start"]
