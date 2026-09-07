#!/bin/sh
# Register THIS Linux box as a PMU-capable self-hosted runner for the RCB proof.
#
# Run it ON a machine with a real hardware PMU — bare metal, or a cloud instance
# that exposes one (AWS *.metal, Equinix/bare-metal, or KVM with vPMU). Standard
# Hyper-V/cloud VMs (incl. GitHub-hosted runners) expose NO PMU and will SKIP.
#
#   gh auth login          # once, with repo admin on letsRunback/runback
#   sh linux/register-pmu-runner.sh
#
# It self-checks the PMU, pulls a registration token, downloads the runner, and
# configures it with the `pmu` label so .github/workflows/rcb-pmu.yml targets it.
set -e
REPO="${RUNBACK_REPO:-letsRunback/runback}"

echo "== checking for a hardware PMU =="
if perf stat -e branches true >/dev/null 2>&1; then
  echo "  ok — perf can read hardware branch counters"
else
  echo "  WARNING: no readable hardware PMU here (perf branches failed)."
  echo "  You can still register, but the RCB test will SKIP. Continue? [y/N]"
  read ans; [ "$ans" = "y" ] || exit 1
fi

echo "== fetching a runner registration token =="
TOKEN="${1:-$(gh api -X POST "repos/$REPO/actions/runners/registration-token" -q .token)}"
[ -n "$TOKEN" ] || { echo "no token (pass one as \$1, or 'gh auth login' with admin)"; exit 1; }

echo "== downloading the GitHub Actions runner =="
mkdir -p actions-runner && cd actions-runner
VER=$(gh api repos/actions/runner/releases/latest -q .tag_name | sed 's/^v//')
curl -fsSL -o runner.tgz \
  "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz"
tar xzf runner.tgz

echo "== configuring with label 'pmu' =="
./config.sh --url "https://github.com/$REPO" --token "$TOKEN" \
  --labels pmu --name "pmu-$(hostname)" --unattended --replace

echo "== starting (Ctrl-C to stop; use ./svc.sh install to run as a service) =="
exec ./run.sh
