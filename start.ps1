# Start Script for Rumble Bunny
# Runs the Headless Server and the Vite Client concurrently

Write-Host "🚀 Starting Rumble Bunny..." -ForegroundColor Cyan

# Start the Node.js Server in the background
Write-Host "Starting Headless Server on port 8080..." -ForegroundColor Yellow
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "03_Stable_Build/server.js"

# Start the Vite Client and expose to local network
Write-Host "Starting Vite Client..." -ForegroundColor Green
cd 04_Render_Engine
npx vite --host
