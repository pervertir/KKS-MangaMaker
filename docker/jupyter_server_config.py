# JupyterLab on the pod. Its root is /workspace, so by default every folder you open or save a file in
# gets an .ipynb_checkpoints/ subfolder, including ComfyUI's models/ folders, where ComfyUI and some
# custom nodes then list or trip over it. Keep all checkpoints outside the volume instead.
c = get_config()  # noqa: F821
c.FileContentsManager.checkpoints_kwargs = {"root_dir": "/tmp/jupyter-checkpoints"}
c.ContentsManager.hide_globs = ["__pycache__", "*.pyc", ".ipynb_checkpoints", "*.part"]
