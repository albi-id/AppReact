postgree data bases , conexion strings
postgresql://postgres:[YOUR-PASSWORD]@db.rrfiaawwjazpmjqyuaxa.supabase.co:5432/postgres

supabase contraseña del proyecto "database password" Contrasenia1!



al tirar post login mariadelalbae@gmail.com ContraseniaSegura123!   da esto
{
    "message": "Inicio de sesión exitoso",
    "token": "eyJhbGciOiJFUzI1NiIsImtpZCI6Ijc1NzdhYzdkLWEyYmUtNDRmOC04MWQxLTBhMWQyMDAzOWFhYiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2dkamthemF1ZW1vamNlYmluc3ZyLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIyMmEwZDM3Yy04NGY4LTQyNjctOGY3ZC00NDQxMDM1OWY3NTUiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY5MTMwNDUxLCJpYXQiOjE3NjkxMjY4NTEsImVtYWlsIjoibWFyaWFkZWxhbGJhZUBnbWFpbC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoibWFyaWFkZWxhbGJhZUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJyb2xlIjoiVVNFUiIsInN1YiI6IjIyYTBkMzdjLTg0ZjgtNDI2Ny04ZjdkLTQ0NDEwMzU5Zjc1NSJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzY5MTI2ODUxfV0sInNlc3Npb25faWQiOiIyZTQyNmU1NC1lMzVhLTQwZjAtODVmNS1mMDJhNzFiMjMxYmUiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.SCwPXraGMk1HeMX086Bx7SQ5c7mSxg9LtKKBZg7nPs6NmfL9U9RmAiubykBe34Vrcaxj7qaTrrfq_b3Jf9_nVg",
    "user": {
        "id": "22a0d37c-84f8-4267-8f7d-44410359f755",
        "email": "mariadelalbae@gmail.com",
        "role": "USER"
    },
    "expiresIn": 3600
}
el token se usa para cerrar sesion

 
### Mañana: Cómo retomar exactamente donde quedamos

1. **Abrí la carpeta del proyecto en VS Code**:
   ```
   D:\AppReact\conGrok
   ```

2. **Abrí una terminal en VS Code** (o CMD/PowerShell) y navegá a la carpeta del backend:
   ```
   cd packages\backend
   ```

3. **Instalá dependencias si es necesario** (solo la primera vez o si cambiaste algo):
   ```
   npm install
   ```

4. **Generá el Prisma Client** (por si acaso, aunque no debería ser necesario):
   ```
   npx prisma generate
   ```

5. **Iniciá el server**:
   ```
   npm run dev
   ```

   → Debería mostrar:
   ```
   DATABASE_URL cargada: Sí
   Server en http://localhost:3000
   ...
   ```

6. **Probár rápido que todo siga vivo**:
   - http://localhost:3000/health → OK
   - http://localhost:3000/users → []
   - POST /login con tu email y contraseña → devuelve token


user 
{"email": "mariadelalbae25@gmail.com", "password": "12345678"}

driver
{"email": "mariadelalbae@gmail.com", "password": "12345678"}
 
 

 -------------------------14/2/26
 1. Comandos para poner a correr el proyecto (hoy 14/02/2026)
Abre varias terminales (o usa pestañas) en D:\AppReact\conGrok
Terminal 1 – Backend
Bashcd packages\backend
npm install               # si hace tiempo que no lo abrís
npx prisma generate        # refresca tipos de Prisma
npm run dev               # levanta el server en http://localhost:3000
Deberías ver:
textDATABASE_URL cargada: Sí
Server en http://localhost:3000
→ Health: http://localhost:3000/health
Terminal 2 – Frontend Web (Vite)
Bashcd packages\web
npm install               # si agregaste paquetes o hace tiempo
npm run dev               # levanta en http://localhost:5173 (o puerto que diga)
Abre en el navegador: http://localhost:5173
Si querés probar desde el celular (misma red WiFi):

En la terminal de Vite aparecerá un QR → escanéalo con el navegador del celular.
O usa la IP que te muestra (ej. http://192.168.1.xxx:5173)



------USUARIOS REGISTRADIS EN LA BASE


user 
{"email": "mariadelalbae25@gmail.com", "password": "12345678"}

{
    "message": "Login exitoso",
    "token": "eyJhbGciOiJFUzI1NiIsImtpZCI6Ijc1NzdhYzdkLWEyYmUtNDRmOC04MWQxLTBhMWQyMDAzOWFhYiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2dkamthemF1ZW1vamNlYmluc3ZyLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiIzOGQ2YTNmNi1mMGRmLTRkZGItYTY5Ni1kOWUwZmJjNWQ4NmIiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY5MzAyMTE2LCJpYXQiOjE3NjkyOTg1MTYsImVtYWlsIjoibWFyaWFkZWxhbGJhZTI1QGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJtYXJpYWRlbGFsYmFlMjVAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiMzhkNmEzZjYtZjBkZi00ZGRiLWE2OTYtZDllMGZiYzVkODZiIn0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3NjkyOTg1MTZ9XSwic2Vzc2lvbl9pZCI6Ijg1OTgzYjBmLTkwZGUtNGIxZS1hOTgzLTc5YzE1ZTdhOGNjNSIsImlzX2Fub255bW91cyI6ZmFsc2V9.Z38zt1lDxBis8KqLGV9h6kC9d5FkSiEsfbLFCsDBq5gH3hsAwe6tl459RupJxFddyPDr_lSXdGJmHhu8Qlo2Xg",
    "user": {
        "id": "38d6a3f6-f0df-4ddb-a696-d9e0fbc5d86b",
        "email": "mariadelalbae25@gmail.com",
        "role": "USER"
    },
    "expiresIn": 3600
}




driver
{"email": "mariadelalbae@gmail.com", "password": "12345678"}
 
 {
    "message": "Login exitoso",
    "token": "eyJhbGciOiJFUzI1NiIsImtpZCI6Ijc1NzdhYzdkLWEyYmUtNDRmOC04MWQxLTBhMWQyMDAzOWFhYiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2dkamthemF1ZW1vamNlYmluc3ZyLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJiOGEwZWZmZS1jODZhLTQ5ZGQtYTExZi03N2Y3MTI3ZWIzNGIiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY5MzAyMTQyLCJpYXQiOjE3NjkyOTg1NDIsImVtYWlsIjoibWFyaWFkZWxhbGJhZUBnbWFpbC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoibWFyaWFkZWxhbGJhZUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiJiOGEwZWZmZS1jODZhLTQ5ZGQtYTExZi03N2Y3MTI3ZWIzNGIifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc2OTI5ODU0Mn1dLCJzZXNzaW9uX2lkIjoiMmQ2MGMxZDctYzNkMC00ZWJmLWI1ZWUtNTAyZDNjOGZjYjBlIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.K_j1XYK50w1GWdx6x-KTAqQtQrOxxcdzX4h_s8BByTJgATMC2tfZE_g_LWGdxt3KqKcptiCA6nI-PHRCe1Xevw",
    "user": {
        "id": "b8a0effe-c86a-49dd-a11f-77f7127eb34b",
        "email": "mariadelalbae@gmail.com",
        "role": "DRIVER"
    },
    "expiresIn": 3600
}



solicitar servicio
{
    "message": "Servicio solicitado correctamente",
    "service": {
        "id": "add348b1-e5e8-4acd-b49d-4a259593c89a",
        "type": "MOTO",
        "status": "REQUESTED",
        "pickup": {
            "lat": -27.451234,
            "lng": -58.987654
        },
        "requestedAt": "2026-01-25T00:04:46.959Z"
    }
}