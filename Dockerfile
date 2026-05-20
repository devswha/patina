# syntax=docker/dockerfile:1

FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:18-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S patina && adduser -S patina -G patina
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY bin ./bin
COPY src ./src
COPY core ./core
COPY patterns ./patterns
COPY profiles ./profiles
COPY lexicon ./lexicon
COPY .patina.default.yaml README.md LICENSE ./
RUN chmod +x bin/patina.js \
  && ln -s /app/bin/patina.js /usr/local/bin/patina \
  && chown -R patina:patina /app
USER patina
ENTRYPOINT ["patina"]
CMD ["--help"]
