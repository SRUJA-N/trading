from fastapi import FastAPI, Depends, HTTPException, status, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone
from typing import Annotated
import asyncio
import random

import models
import schemas
from database import engine, get_db

# ------------------------------
# APP INIT
# ------------------------------
app = FastAPI()  # Initialize FastAPI app

# ------------------------------
# JWT CONFIGURATION
# ------------------------------
SECRET_KEY = "your-super-secret-key-that-no-one-should-know"  # Secret key for JWT
ALGORITHM = "HS256"  # JWT algorithm
ACCESS_TOKEN_EXPIRE_MINUTES = 30  # Token expiry
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")  # OAuth2 dependency for token retrieval

# ------------------------------
# PASSWORD HASHING
# ------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")  # Hashing context for user passwords

# ------------------------------
# CREATE DATABASE TABLES
# ------------------------------
models.Base.metadata.create_all(bind=engine)  # Create tables defined in models

# ------------------------------
# CORS CONFIGURATION
# ------------------------------
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,        # Allow local frontend origins
    allow_credentials=True,
    allow_methods=["*"],          # Allow all HTTP methods
    allow_headers=["*"],          # Allow all headers
)

# ------------------------------
# HELPER FUNCTIONS
# ------------------------------

def create_access_token(data: dict):
    """
    Creates a JWT token with expiration.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)
):
    """
    FastAPI dependency to get the current logged-in user.
    Verifies JWT token and fetches user from DB.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

# ------------------------------
# AUTH ENDPOINTS
# ------------------------------

@app.post("/signup", response_model=schemas.UserOut, status_code=201)
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user.
    Validates email uniqueness and password confirmation.
    """
    existing = db.query(models.User).filter(models.User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    if user.password != user.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    
    hashed = pwd_context.hash(user.password)  # Hash password
    db_user = models.User(email=user.email, hashed_password=hashed)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@app.post("/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    User login endpoint.
    Verifies credentials and returns JWT access token.
    """
    db_user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not db_user or not pwd_context.verify(form_data.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/users/me", response_model=schemas.UserOut)
async def read_users_me(current_user: Annotated[models.User, Depends(get_current_user)]):
    """
    Get current logged-in user details.
    """
    return current_user


# ------------------------------
# WEBSOCKET ENDPOINT
# ------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint to stream live stock data.
    Sends price, volume, and change percent every second.
    """
    await websocket.accept()
    price = 150.00
    volume = 10000

    try:
        while True:
            change = round(random.uniform(-1, 1), 2)
            price = round(price + change, 2)
            if price < 0:
                price = 0.01

            change_percent = round((change / price) * 100, 2)
            volume += random.randint(-200, 300)
            if volume < 0:
                volume = 0

            # Send stock update to client
            await websocket.send_json({
                "stock": "GEMINI",
                "price": price,
                "volume": volume,
                "change_percent": change_percent
            })

            await asyncio.sleep(1)

    except Exception as e:
        print(f"WebSocket Error: {e}")
    finally:
        print("Client disconnected")


# ------------------------------
# TRADE ENDPOINT
# ------------------------------

@app.post("/trade")
def trade(
    trade: schemas.TradeBase,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """
    Execute a trade (BUY or SELL).
    Updates user's portfolio and records trade history.
    """
    cost = trade.quantity * trade.price

    if trade.trade_type.upper() == "BUY":
        holding = db.query(models.Portfolio).filter_by(
            user_id=current_user.id, symbol=trade.symbol
        ).first()
        if holding:
            total_cost = holding.quantity * holding.avg_price + cost
            holding.quantity += trade.quantity
            holding.avg_price = total_cost / holding.quantity
        else:
            holding = models.Portfolio(
                user_id=current_user.id,
                symbol=trade.symbol,
                quantity=trade.quantity,
                avg_price=trade.price
            )
            db.add(holding)

    elif trade.trade_type.upper() == "SELL":
        holding = db.query(models.Portfolio).filter_by(
            user_id=current_user.id, symbol=trade.symbol
        ).first()
        if not holding or holding.quantity < trade.quantity:
            raise HTTPException(status_code=400, detail="Not enough shares to sell")
        holding.quantity -= trade.quantity
        if holding.quantity == 0:
            db.delete(holding)
    else:
        raise HTTPException(status_code=400, detail="Invalid trade type")

    # Record trade
    new_trade = models.Trade(
        user_id=current_user.id,
        symbol=trade.symbol,
        trade_type=trade.trade_type.upper(),
        quantity=trade.quantity,
        price=trade.price
    )
    db.add(new_trade)
    db.commit()
    return {"message": f"{trade.trade_type} executed successfully"}


# ------------------------------
# PORTFOLIO ENDPOINT
# ------------------------------

@app.get("/portfolio", response_model=list[schemas.Portfolio])
def get_portfolio(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """
    Get all portfolio holdings for the current user.
    """
    return db.query(models.Portfolio).filter_by(user_id=current_user.id).all()


# ------------------------------
# TRADE HISTORY ENDPOINT
# ------------------------------

@app.get("/trade-history", response_model=list[schemas.Trade])
def get_trade_history(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db)
):
    """
    Get all trade history for the current user, ordered by timestamp descending.
    """
    return db.query(models.Trade).filter_by(user_id=current_user.id).order_by(models.Trade.timestamp.desc()).all()
