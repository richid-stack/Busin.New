#!/usr/bin/env bash
# Rebuilds every video from the raw footage and the motion scenes. Run from the repository root.
set -e
# The app recordings (landing/media/raw) are made by film.cjs against the capture server and are not in git. Say so now, not halfway through.
for n in chat sales approval newtask tasks workflow agents reef computers integrations models; do
  [ -f landing/media/raw/$n.mp4 ] || { echo "Missing landing/media/raw/$n.mp4. Start the capture server (landing/capture/server.mts) and run: node landing/capture/film.cjs"; exit 1; }
done
python3 landing/capture/stage/make_assets.py
node landing/capture/stage/bgstill.cjs
node landing/capture/stage.cjs intro montage outro tag vs_install vs_bridge vs_deploy tut_keys
python3 landing/capture/edit.py
# the motion scenes use the same encoder settings as the edited footage so scenes can be joined without re-encoding
for n in intro montage outro tag vs_install vs_bridge vs_deploy tut_keys; do
  ffmpeg -y -loglevel error -i landing/media/raw/$n.mp4 -r 30 -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -movflags +faststart landing/media/scenes/$n.tmp.mp4 && mv landing/media/scenes/$n.tmp.mp4 landing/media/scenes/$n.mp4
done
A=landing/capture/assemble.py
python3 $A ad-main intro chat_ad approval_ad tasks_ad workflow_ad agents reef_ad computers integrations montage outro
python3 $A feature-chat chat sales approval tag
python3 $A feature-tasks newtask tasks tag
python3 $A feature-workflows workflow tag
python3 $A feature-agents-reef agents reef tag
python3 $A feature-computers computers tag
python3 $A feature-integrations integrations models tag
python3 $A tutorial-install vs_install tag
python3 $A tutorial-bridge vs_bridge computers tag
python3 $A tutorial-keys tut_keys models tag
python3 $A tutorial-deploy vs_deploy tag
