# TuraAgent Web3 Installation and Deployment Guide

## Prerequisites

1. Server Requirements:
   - Ubuntu/Linux server
   - Node.js 18+ (using nvm)
   - Python 3.8+
   - pnpm package manager
   - Git

2. Environment Setup:
   ```bash
   # Install Node.js using nvm
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 18
   nvm use 18

   # Install pnpm
   curl -fsSL https://get.pnpm.io/install.sh | sh -
   source ~/.bashrc

   # Install Python dependencies
   sudo apt update
   sudo apt install -y python3-pip python3-venv
   ```

## Backend Deployment

1. Clone and Setup:
   ```bash
   git clone https://github.com/roturalabs/AWS-Home-Demo.git
   cd AWS-Home-Demo/backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. Environment Configuration:
   Create `.env` file in the backend directory:
   ```
   RPC_URL=http://43.135.26.222:8000
   CHAIN_ID=1337
   OPENAI_API_KEY=your_openai_api_key
   ```

3. Start Backend Service:
   ```bash
   # Development
   uvicorn main:app --reload --host 0.0.0.0 --port 8000

   # Production (using gunicorn)
   pip install gunicorn
   gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
   ```

## Frontend Deployment

1. Setup Frontend:
   ```bash
   cd ../tura-wallet
   pnpm install
   ```

2. Environment Configuration:
   Create `.env` file in the tura-wallet directory:
   ```
   VITE_OPENAI_API_KEY=your_openai_api_key
   VITE_RPC_URL=http://43.135.26.222:8000
   VITE_CHAIN_ID=1337
   VITE_CHAIN_NAME=Tura
   ```

3. Build and Deploy:
   ```bash
   # Build the project
   pnpm build

   # The build output will be in the dist directory
   # Deploy using your preferred static file server (e.g., nginx)
   ```

4. Nginx Configuration (Example):
   ```nginx
   server {
       listen 80;
       server_name your_domain.com;

       # Frontend
       location / {
           root /path/to/AWS-Home-Demo/tura-wallet/dist;
           try_files $uri $uri/ /index.html;
       }

       # Backend API
       location /api {
           proxy_pass http://localhost:8000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

## Smart Contract Deployment

1. Access Remix IDE:
   - Open https://remix.ethereum.org/
   - Import your smart contracts

2. Configure Metamask:
   - Add Tura Network:
     - Network Name: Tura
     - RPC URL: http://43.135.26.222:8000
     - Chain ID: 1337
     - Currency Symbol: TURA

3. Deploy Contracts:
   - Use Remix IDE connected to Tura network
   - Deploy in order:
     1. TuraAgentMultiSig
     2. TURA token
     3. Test tokens (if needed)

4. Update Frontend Configuration:
   After deployment, update the contract addresses in the frontend environment:
   ```
   VITE_CONTRACT_ADDRESS=your_deployed_contract_address
   ```

## Verification Steps

1. Backend:
   - Access API documentation at `http://your_domain.com/api/docs`
   - Verify API endpoints are responding correctly

2. Frontend:
   - Verify all UI elements are properly rendered
   - Test wallet connectivity
   - Confirm contract interactions
   - Test agent dialogue functionality

3. Smart Contracts:
   - Verify contract deployment on Tura chain
   - Test basic contract interactions
   - Confirm multi-signature operations

## Troubleshooting

1. Backend Issues:
   - Check logs: `journalctl -u your_backend_service`
   - Verify environment variables
   - Ensure proper Python version

2. Frontend Issues:
   - Check browser console for errors
   - Verify environment variables
   - Clear browser cache if needed

3. Contract Issues:
   - Verify correct network connection
   - Check contract addresses
   - Ensure sufficient TURA balance for transactions
