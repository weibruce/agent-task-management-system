FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf

COPY atms_node/src/runtime/plugin-runtime-runner.mjs /usr/local/bin/atms-plugin-runtime
RUN chmod 0555 /usr/local/bin/atms-plugin-runtime \
    && mkdir -p /opt/atms/plugin \
    && chown 65532:65532 /opt/atms/plugin

USER 65532:65532
ENTRYPOINT []
CMD ["/usr/local/bin/atms-plugin-runtime", "--serve"]
