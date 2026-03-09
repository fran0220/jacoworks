"""
Agent 路由 — 注册、查询、管理
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Optional, List

from app.database import get_db
from app.auth.dependencies import get_current_agent, verify_admin
from app.services import agent_service
from app.models.agent import Agent
from app.config import config


router = APIRouter(prefix="/agents", tags=["Agent"])


# ============================================================
# 请求/响应模型
# ============================================================

class AgentRegisterRequest(BaseModel):
    name: str = Field(..., description="Agent 名称", max_length=100)
    role: str = Field(..., description="角色: planner/executor/reviewer/patrol")
    description: str = Field("", description="职责简要")


class AgentResponse(BaseModel):
    id: str
    name: str
    role: str
    description: str
    status: str
    total_score: int

    class Config:
        from_attributes = True


class AgentRegisterResponse(BaseModel):
    id: str
    name: str
    role: str
    api_key: str
    message: str = "注册成功，请保存 API Key"


class AgentStatusRequest(BaseModel):
    status: str = Field(..., description="状态: available/busy/offline")


# ============================================================
# Agent 自注册（用注册令牌）
# ============================================================

@router.post("/register", response_model=AgentRegisterResponse, summary="Agent 自动注册")
async def register_agent(
    req: AgentRegisterRequest,
    x_registration_token: str = Header(..., alias="X-Registration-Token"),
    db: Session = Depends(get_db),
):
    """Agent 使用注册令牌自注册，获取 API Key"""
    if not config.allow_registration:
        raise HTTPException(status_code=403, detail="Agent 自注册已关闭，请联系管理员创建")
    if x_registration_token != config.registration_token:
        raise HTTPException(status_code=403, detail="注册令牌无效")

    try:
        agent = agent_service.register_agent(db, req.name, req.role, req.description)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return AgentRegisterResponse(
        id=agent.id,
        name=agent.name,
        role=agent.role,
        api_key=agent.api_key,
    )


# ============================================================
# 管理员创建 Agent
# ============================================================

@router.post("", response_model=AgentRegisterResponse, summary="管理员创建 Agent")
async def create_agent(
    req: AgentRegisterRequest,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """管理员直接创建 Agent"""
    try:
        agent = agent_service.register_agent(db, req.name, req.role, req.description)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return AgentRegisterResponse(
        id=agent.id,
        name=agent.name,
        role=agent.role,
        api_key=agent.api_key,
    )


# ============================================================
# 查询 Agent 列表（Agent 和管理员都可用）
# ============================================================

@router.get("", response_model=List[AgentResponse], summary="查看 Agent 列表")
async def list_agents(
    role: Optional[str] = None,
    status: Optional[str] = None,
    agent: Agent = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """查看已注册的 Agent 列表，可按角色和状态过滤"""
    agents = agent_service.list_agents(db, role=role, status=status)
    return agents


# ============================================================
# 更新 Agent 状态
# ============================================================

@router.put("/{agent_id}/status", response_model=AgentResponse, summary="更新 Agent 状态")
async def update_status(
    agent_id: str,
    req: AgentStatusRequest,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """管理员更新 Agent 状态"""
    try:
        agent = agent_service.update_agent_status(db, agent_id, req.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return agent
