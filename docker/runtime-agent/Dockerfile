# The runtime agent container (PoC 1). Build from the repo root:
#   pnpm runtime:build
#
# It runs the runner (Agent SDK + runtime tools) and the static applet server.
# The applet is built once, at image build time.

FROM node:24-slim

RUN npm install -g pnpm@12.6.0

WORKDIR /opt/familiar
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter "runner..." --filter "applet-runtime..." --filter "translation-applet..." \
  && pnpm --filter applet-runtime build

# The runtime agent's workspace: a copy of the applet source it can read (and later edit),
# plus its runtime instructions, root-owned and read-only.
RUN mkdir -p /home/node/work \
  && cp -r packages/translation-applet/. /home/node/work/ \
  && rm -rf /home/node/work/node_modules \
  && chown -R node:node /home/node/work
COPY --chmod=444 docker/runtime-agent/CLAUDE.md /home/node/work/CLAUDE.md
COPY --chmod=444 docker/runtime-agent/scenario.md /opt/familiar/scenario.md

ENV WORK_DIR=/home/node/work \
  DIST_DIR=/opt/familiar/packages/applet-runtime/dist \
  SCENARIO_FILE=/opt/familiar/scenario.md

USER node
EXPOSE 8080
CMD ["sh", "-c", "node packages/runner/src/serve.ts & exec node packages/runner/src/main.ts"]
