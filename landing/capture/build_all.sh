#!/usr/bin/env bash
# Rebuilds every video from the raw footage and the motion scenes. Run from the repository root.
set -e
python3 landing/capture/stage/make_assets.py
node landing/capture/stage/bgstill.cjs
node landing/capture/stage.cjs intro montage outro tag tut_install tut_bridge_a tut_bridge_b tut_keys
python3 landing/capture/edit.py
# the motion scenes use the same encoder settings as the edited footage so scenes can be joined without re-encoding
for n in intro montage outro tag tut_install tut_bridge_a tut_bridge_b tut_keys; do
  ffmpeg -y -loglevel error -i landing/media/raw/$n.mp4 -r 30 -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -movflags +faststart landing/media/scenes/$n.tmp.mp4 && mv landing/media/scenes/$n.tmp.mp4 landing/media/scenes/$n.mp4
done
A=landing/capture/assemble.py
python3 $A ad-main intro chat_ad approval_ad tasks_ad workflow_ad agents reef_ad computers integrations montage outro
python3 $A feature-chat chat approval tag
python3 $A feature-tasks tasks tag
python3 $A feature-workflows workflow tag
python3 $A feature-agents-reef agents reef tag
python3 $A feature-computers computers tag
python3 $A feature-integrations integrations models tag
python3 $A tutorial-install tut_install tag
python3 $A tutorial-bridge tut_bridge_a tut_bridge_b computers tag
python3 $A tutorial-keys tut_keys models tag
