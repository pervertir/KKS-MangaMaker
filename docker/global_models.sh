#!/bin/bash
# Keep ComfyUI's model folders on the global volume (RunPod "global" storage, mounted at
# /workspace-global): every models/<type> folder becomes a symlink to $G/<type>. Existing files are
# copied over once. geesefs (the global volume's filesystem) refuses chown/utime and rsync's temp
# files, hence the plain `rsync -r --inplace`.
set -u
M=/workspace/runpod-slim/ComfyUI/models
G=${MANGA_MODELS_DIR:-/workspace-global/models}
mkdir -p "$G" || exit 1
cd "$M" || exit 1
for d in *; do
    [ "$d" = configs ] && continue        # ComfyUI's own files, keep with the code
    [ -L "$d" ] && continue
    [ -d "$d" ] || continue
    echo "global: moving models/$d ($(du -sh "$d" | cut -f1))"
    find "$d" -name '*.part' -delete
    mkdir -p "$G/$d"
    if rsync -r --inplace "$d/" "$G/$d/"; then
        mv "$d" "$d.old" && ln -s "$G/$d" "$d" && rm -rf "$d.old"
    else
        echo "global: copy of models/$d failed; left it on the pod volume"
    fi
done
# Folders a newer ComfyUI or a custom node adds later get linked too.
for g in "$G"/*/; do
    n=$(basename "$g")
    [ -e "$M/$n" ] || ln -s "$G/$n" "$M/$n"
done
