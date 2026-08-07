# 🛡️ VaultAgent

VaultAgent is a state-of-the-art, local-first AI reasoning copilot designed to index, connect, and enrich your personal markdown note vaults (such as Obsidian vaults). Built with **Tauri v2**, **Rust**, **React (TypeScript)**, and a **Python backend**, it combines semantic search, local graph visualizations, web-scraping agents, and vector-based contextual memory databases into a sleek, premium desktop experience.

---

## 🚀 Key Features

*   **Local Note Indexing & Graph Visualizations:** Maps and tracks node directories, orphans, and neighbors in real time.
*   **AI Copilot (Web Search & Parallel Crawler):** Augments LLM reasoning by executing DuckDuckGo search queries and parallel-scraping reference URLs using our custom crawler pipeline.
*   **Sources & Reasoning Inspector:** An interactive tab in the preview panel allowing you to view queried search queries and expand expandable code panes to inspect raw scraped markdown files used to build the note.
*   **Auto-WikiLinking:** Intelligently tags synthesized content and links existing files (e.g., `[[recursion]]`, `[[graph-theory]]`) without breaking note integrity.
*   **Dynamic Contextual memory:** Generates and queries historical memory facts customized for each indexed vault.

---

## 📦 Installation & Download Guide

To download VaultAgent, visit the **Releases** tab on the GitHub repository:
👉 [VaultAgent GitHub Releases](https://github.com/MIHIRrPATIL/VaultAgent/releases)

Select the installer appropriate for your operating system:

| Operating System | Download File | Installation Steps |
| :--- | :--- | :--- |
| **Windows** | `VaultAgent_1.0.0_x64_en-US.msi` | Double-click the `.msi` file to run the setup wizard. Start the app from the Desktop or Start Menu. |
| **macOS** | `VaultAgent_1.0.0_x64.dmg` | Open the `.dmg` file and drag **VaultAgent** into your **Applications** folder. |
| **Linux (Ubuntu/Debian)** | `vault-agent_1.0.0_amd64.deb` | Open your terminal and install it using: <br>`sudo dpkg -i vault-agent_1.0.0_amd64.deb` |
| **Linux (Arch, Fedora, rolling)** | `vault-agent_1.0.0_amd64.AppImage` | 1. Open your terminal in the downloads folder.<br>2. Make it executable: `chmod +x vault-agent_1.0.0_amd64.AppImage`<br>3. Run it: `./vault-agent_1.0.0_amd64.AppImage` |

---

## ⚙️ How It Works (First-Launch Auto Setup)

To keep installers lightweight (~5MB) and support independent server updates, VaultAgent features an **automatic runtime setup system**:

1.  **First Launch:** When you run the application for the first time, it displays a **"Setting up VaultAgent"** splash screen.
2.  **Smart Downloader:** In the background, the Rust client detects your host OS (Windows/Mac/Linux) and processor architecture (Intel x86_64 / Apple Silicon aarch64) to stream the correct precompiled backend reasoning binary from GitHub Releases.
3.  **Local Execution:** The binary is saved into your local app data directory, marked as executable, and spawned automatically on a dynamic local port. 
4.  **Subsequent Runs:** Launch immediately (in less than a second) without downloading anything.

---

## 🛠️ Local Development & Setup

If you wish to run, test, or develop VaultAgent locally from source code, follow these steps:

### Prerequisites
*   [Node.js](https://nodejs.org/) & [Bun](https://bun.sh/)
*   [Rust](https://www.rust-lang.org/) (for Tauri client)
*   [Python 3.10+](https://www.python.org/)

### 1. Run the Backend Server
```bash
cd server
# Create virtual environment
python3 -m venv venv
source venv/bin/activate # On Windows use: .\venv\Scripts\activate
# Install requirements
pip install -r requirements.txt
# Run the FastAPI server
python app.py
```

### 2. Run the Desktop Client
```bash
cd client
# Install packages
bun install
# Launch Tauri developer server
bun tauri dev
```
