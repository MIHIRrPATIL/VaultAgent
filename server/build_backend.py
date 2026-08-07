import os
import sys
import shutil
import subprocess

def run_cmd(cmd, cwd=None):
    print(f"Running: {' '.join(cmd)}")
    res = subprocess.run(cmd, cwd=cwd)
    if res.returncode != 0:
        print(f"Error running command: {cmd}")
        sys.exit(res.returncode)

def main():
    server_dir = os.path.dirname(os.path.abspath(__file__))
    venv_python = os.path.join(server_dir, "venv", "bin", "python")
    if sys.platform == "win32":
        venv_python = os.path.join(server_dir, "venv", "Scripts", "python.exe")

    # 1. Install pyinstaller inside the virtual env
    print("Installing PyInstaller...")
    run_cmd([venv_python, "-m", "pip", "install", "pyinstaller"], cwd=server_dir)

    # 2. Define the executable name
    exe_name = "vaultagent-backend"
    if sys.platform == "win32":
        exe_name = "vaultagent-backend.exe"

    # 3. Run PyInstaller
    print("Compiling Python backend into a standalone binary...")
    pyinstaller_bin = os.path.join(server_dir, "venv", "bin", "pyinstaller")
    if sys.platform == "win32":
        pyinstaller_bin = os.path.join(server_dir, "venv", "Scripts", "pyinstaller.exe")

    build_cmd = [
        pyinstaller_bin,
        "--clean",
        "--onefile",
        "--name", "vaultagent-backend",
        # Ensure we collect dynamic dependencies and templates
        "--collect-all", "uvicorn",
        "--collect-all", "fastapi",
        "--collect-all", "pydantic",
        "--collect-all", "jinja2",
        "--collect-all", "duckduckgo_search",
        "--collect-all", "crawl4ai",
        "--exclude-module", "nltk",
        "app.py"
    ]
    run_cmd(build_cmd, cwd=server_dir)

    # 4. Copy the compiled executable to client/src-tauri/binaries/
    dist_dir = os.path.join(server_dir, "dist")
    compiled_exe = os.path.join(dist_dir, exe_name)

    tauri_binaries_dir = os.path.abspath(os.path.join(server_dir, "..", "client", "src-tauri", "binaries"))
    os.makedirs(tauri_binaries_dir, exist_ok=True)
    
    dest_path = os.path.join(tauri_binaries_dir, exe_name)
    print(f"Copying compiled binary to {dest_path}...")
    shutil.copy2(compiled_exe, dest_path)
    
    print("\nBackend sidecar compiled and placed successfully!")

if __name__ == "__main__":
    main()
