FROM node:22-slim
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY company-brain/index.html ./company-brain/index.html
ENV PORT=8787 TACIT_DB=/data/tacit.db
VOLUME /data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.mjs"]
