#!/usr/bin/env bash
# ============================================================================
# Cuts the raw clips for the product video (16:9, ~32s)
#
# Order: title, login, poll, inbox, outro.
#
# ----------------------------------------------------------------------------
# The cut points are measured, not guessed
#
# For every raw clip a contact sheet was generated (ffmpeg tile) and
# checked for when which frame actually appears. That was necessary for
# the inbox: the recording starts with logging in as Ansem, the inbox
# itself only starts at second 6. There was no guessing that.
#
# ----------------------------------------------------------------------------
# On pacing
#
# Exactly one spot is sped up - waiting for the payment - and it is
# labeled "3x" in the frame. The factor in the label is the same one in
# the filter (setpts=PTS/3). A video that runs faster than it claims
# promises a login in three seconds that in reality takes half a minute.
#
# ----------------------------------------------------------------------------
# "demo data"
#
# The inbox carries a notice the whole time. The conversations are
# invented - the site is new and has none yet. The README says the same
# ("any post showing a full inbox is showing invented data"), and a video
# without the notice would contradict that.
#
#   bash scripts/produktvideo-schnitt.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

ROH=video-roh
ARB=/tmp/videoschnitt
AUS=sized-produktvideo.mp4
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf
FONT_R=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
rm -rf "$ARB"; mkdir -p "$ARB"

# Subtitle: light text on a dark bar, bottom third.
# box=1 instead of a custom overlay - a bar that sizes itself to the text
# length does not need to be measured out by hand.
unterzeile() {
  local datei="$1"
  echo "drawtext=fontfile=$FONT:textfile=$datei:fontsize=40:fontcolor=white@0.96\
:box=1:boxcolor=black@0.78:boxborderw=26:x=(w-text_w)/2:y=h-128"
}

schreib() { printf '%s' "$2" > "$ARB/$1.txt"; echo "$ARB/$1.txt"; }

# ---------------------------------------------------------------------------
# 0. Title
# ---------------------------------------------------------------------------
t1=$(schreib t1 'SIZED')
t2=$(schreib t2 'token-gated polls and DMs for $ANSEM holders')
ffmpeg -v error -y -f lavfi -i color=c=0x0a0a0c:s=1920x1080:d=1.8:r=30 \
  -vf "drawtext=fontfile=$FONT:textfile=$t1:fontsize=150:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-60,\
drawtext=fontfile=$FONT_R:textfile=$t2:fontsize=38:fontcolor=0x8a8a95:x=(w-text_w)/2:y=(h-text_h)/2+90" \
  -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/00-titel.mp4"

# ---------------------------------------------------------------------------
# 1. Login  (raw clip 1-anmelden.webm, 14.5s)
#    measured: typing 1.0-5.4 | amount 5.6-9.0 | waiting 9.0-11.6 | in 11.8-14.4
# ---------------------------------------------------------------------------
u=$(schreib u1a 'type your Solana address')
ffmpeg -v error -y -ss 1.0 -to 5.4 -i "$ROH/1-anmelden.webm" \
  -vf "setpts=PTS/1.6,$(unterzeile $u)" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/01a.mp4"

u=$(schreib u1b 'an exact amount - no wallet connect, no signature')
ffmpeg -v error -y -ss 5.6 -to 9.0 -i "$ROH/1-anmelden.webm" \
  -vf "$(unterzeile $u)" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/01b.mp4"

u=$(schreib u1c '3x  -  waiting for the payment')
ffmpeg -v error -y -ss 9.0 -to 11.6 -i "$ROH/1-anmelden.webm" \
  -vf "setpts=PTS/3,$(unterzeile $u)" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/01c.mp4"

# Arriving is shown by the START of clip 2, not the end of clip 1.
#
# At the end of clip 1 the poll page is there, but has half slid out of
# frame - at zoom 2 the list is taller than the window, and the browser
# still sits at the bottom. In the contact sheet that looked like a broken
# page. Clip 2 starts cleanly at the top and shows the same thing: you're in.
u=$(schreib u1d 'verified - you are in')
ffmpeg -v error -y -ss 0.4 -to 2.4 -i "$ROH/2-abstimmen.webm" \
  -vf "$(unterzeile $u)" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/01d.mp4"

# ---------------------------------------------------------------------------
# 2. Voting  (raw clip 2-abstimmen.webm, 8.8s)
# ---------------------------------------------------------------------------
u=$(schreib u2a 'polls - one wallet, one vote')
ffmpeg -v error -y -ss 2.4 -to 5.2 -i "$ROH/2-abstimmen.webm" \
  -vf "$(unterzeile $u)" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/02a.mp4"

u=$(schreib u2b 'your vote weighs what your wallet holds')
ffmpeg -v error -y -ss 5.2 -to 8.8 -i "$ROH/2-abstimmen.webm" \
  -vf "$(unterzeile $u)" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/02b.mp4"

# ---------------------------------------------------------------------------
# 3. Inbox  (raw clip 3-posteingang.webm; inbox starts at 6.2s)
#    Labeled as demo throughout.
# ---------------------------------------------------------------------------
demo=$(schreib demo 'demo data')
BADGE="drawtext=fontfile=$FONT:textfile=$demo:fontsize=30:fontcolor=0xffd479\
:box=1:boxcolor=black@0.55:boxborderw=16:x=w-text_w-70:y=150"

u=$(schreib u3a 'his inbox, sorted by holdings')
ffmpeg -v error -y -ss 6.2 -to 11.2 -i "$ROH/3-posteingang.webm" \
  -vf "$(unterzeile $u),$BADGE" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/03a.mp4"

u=$(schreib u3b 'he sets the threshold - $1,000 in $ANSEM to reach him')
ffmpeg -v error -y -ss 11.2 -to 15.4 -i "$ROH/3-posteingang.webm" \
  -vf "$(unterzeile $u),$BADGE" -an -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/03b.mp4"

# ---------------------------------------------------------------------------
# 4. Outro
# ---------------------------------------------------------------------------
e1=$(schreib e1 'sized.gg')
e2=$(schreib e2 'open source  -  github.com/sizedgg/sized')
ffmpeg -v error -y -f lavfi -i color=c=0x0a0a0c:s=1920x1080:d=2.8:r=30 \
  -vf "drawtext=fontfile=$FONT:textfile=$e1:fontsize=110:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40,\
drawtext=fontfile=$FONT_R:textfile=$e2:fontsize=34:fontcolor=0x8a8a95:x=(w-text_w)/2:y=(h-text_h)/2+80" \
  -c:v libx264 -pix_fmt yuv420p -r 30 "$ARB/04-abspann.mp4"

# ---------------------------------------------------------------------------
# Assembling
# ---------------------------------------------------------------------------
: > "$ARB/liste.txt"
for f in 00-titel 01a 01b 01c 01d 02a 02b 03a 03b 04-abspann; do
  echo "file '$ARB/$f.mp4'" >> "$ARB/liste.txt"
done
ffmpeg -v error -y -f concat -safe 0 -i "$ARB/liste.txt" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "$AUS"

echo
printf 'Fertig: %s  %s  %.1fs  %s KB\n' "$AUS" \
  "$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$AUS")" \
  "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUS")" \
  "$(( $(stat -c%s "$AUS") / 1024 ))"
