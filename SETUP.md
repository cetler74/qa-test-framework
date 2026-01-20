# Setup Instructions

## 1. Create .env File

Create a `.env` file in the root directory with the following content:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qa_framework
DB_USER=postgres
DB_PASSWORD=your_actual_password_here

# Server Configuration
PORT=3000
NODE_ENV=development

# File Upload Configuration
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760

# Report Configuration
REPORTS_DIR=./reports
```

**Important**: Replace `your_actual_password_here` with your actual PostgreSQL password.

## 2. Run Database Migrations

After creating the `.env` file with your database credentials, run:

```bash
npm run migrate
```

This will:
- Create the `qa_framework` database if it doesn't exist
- Create all necessary tables

## 3. Start the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

## Troubleshooting

### Error: "client password must be a string"

This means the `DB_PASSWORD` in your `.env` file is either:
- Not set
- Set to an empty value
- Not properly formatted

**Solution**: Make sure your `.env` file has a valid password:
```env
DB_PASSWORD=your_password_here
```

If your password contains special characters, make sure to quote it or escape them properly.

### Error: "Connection refused"

This means PostgreSQL is not running or the connection details are incorrect.

**Solution**: 
- Make sure PostgreSQL is running
- Verify `DB_HOST`, `DB_PORT`, and `DB_USER` in your `.env` file
- Check that your PostgreSQL user has permission to create databases

