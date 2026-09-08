FROM node:20-alpine
WORKDIR /app
COPY . .
RUN node build.js
ENV PORT=7033 HOST=0.0.0.0
EXPOSE 7033
VOLUME ["/app/data"]
CMD ["node", "server.js"]
