# Backend Deployment Checklist

## 🚀 Deploy to Render.com

### 1. Push to GitHub
```powershell
# Navigate to backend directory
cd d:\gitgub\Research2026\LegalcaseBackend

# Initialize git (if not already)
git init
git add .
git commit -m "Initial backend deployment"

# Create new repo at: https://github.com/new
# Name it: legalcase-backend

# Add remote and push
git remote add origin https://github.com/YOUR_USERNAME/legalcase-backend.git
git branch -M main
git push -u origin main
```

### 2. Deploy on Render

1. Go to: https://dashboard.render.com
2. Click: **New +** → **Web Service**
3. Connect GitHub repository: `legalcase-backend`

### 3. Configuration Settings

| Setting | Value |
|---------|-------|
| **Name** | `legalcase-backend` |
| **Region** | Oregon (or closest to you) |
| **Branch** | `main` |
| **Root Directory** | `.` (leave empty) |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node app.js` |
| **Instance Type** | `Free` |

### 4. Environment Variables

Click **Advanced** → **Add Environment Variable**:

```
PORT=5000
NODE_ENV=production
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/
DB_NAME=legalcases
GEMINI_API_KEY=your_api_key_here
PYTHON_SERVICE_URL=https://legalcase-python.onrender.com
FRONTEND_URL=https://legalcase-frontend.vercel.app
```

**Important:** 
- Get MONGO_URI from MongoDB Atlas
- Get GEMINI_API_KEY from Google AI Studio
- Update PYTHON_SERVICE_URL after deploying Python service
- Update FRONTEND_URL after deploying frontend

### 5. Deploy

1. Click **Create Web Service**
2. Wait 5-10 minutes for build
3. Check logs for any errors
4. Copy your backend URL: `https://legalcase-backend.onrender.com`

### 6. Test Backend

Visit: `https://legalcase-backend.onrender.com/api/cases`

Should return: Empty array `[]` or list of cases

---

## Alternative: Railway.app ($5/month - No Sleep)

### 1. Deploy
1. Go to: https://railway.app
2. **New Project** → **Deploy from GitHub**
3. Select: `legalcase-backend`
4. Railway auto-detects Node.js

### 2. Add Environment Variables
Same as Render (see above)

### 3. Add $5 Credit
- Go to account settings
- Add payment method
- Service won't sleep!

---

## Files Needed

Make sure these files exist in your backend repo:

- ✅ `package.json` - Node.js dependencies
- ✅ `app.js` - Main server file
- ✅ `.env.example` - Environment template (don't commit .env!)
- ✅ `README.md` - Documentation
- ❌ `.env` - DO NOT COMMIT THIS!
- ❌ `node_modules/` - Add to .gitignore

---

## .gitignore

Create `.gitignore` file:
```
node_modules/
.env
*.log
uploads/
temp_*.json
*.faiss
__pycache__/
```

---

## Health Check

Backend should respond at:
- `/api/cases` - List all cases
- `/api/query` - Query endpoint

---

## Troubleshooting

### Build Fails
- Check `package.json` has all dependencies
- Check Node version compatibility
- Check build logs in Render

### MongoDB Connection Error
- Verify MONGO_URI format
- Check MongoDB Atlas network access (0.0.0.0/0)
- Verify database user has correct permissions

### Service Crashes
- Check logs in Render dashboard
- Verify all environment variables are set
- Check MongoDB connection string

---

## After Deployment

1. ✅ Copy backend URL
2. ✅ Update Python service with this URL
3. ✅ Update frontend VITE_API_URL with this URL
4. ✅ Test endpoints work
5. ✅ Check logs for errors

---

## Your Backend URL

After deployment, save this:
```
https://legalcase-backend.onrender.com
```

Use this in:
- Frontend `VITE_API_URL`
- Any API testing tools
