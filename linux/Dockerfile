# One-command proof of the syscall tier on Linux.
#
#   docker build -f linux/Dockerfile -t runback-syscall linux
#   docker run --rm --cap-add=SYS_PTRACE runback-syscall
#
# (ptrace of a child needs CAP_SYS_PTRACE, which Docker drops by default — hence
# --cap-add=SYS_PTRACE. The fusion-into-audit step is skipped here unless node is
# present; it uses the same cassette format already proven by the libc tier.)
FROM gcc:13
WORKDIR /w
COPY syscall_record.c probe.c test.sh ./
CMD ["sh", "test.sh"]
