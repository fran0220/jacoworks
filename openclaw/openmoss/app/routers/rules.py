"""
规则提示词路由 — CRUD + 合并获取
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime as dt

from app.database import get_db
from app.auth.dependencies import get_current_agent, verify_admin
from app.services import rule_service
from app.models.agent import Agent


router = APIRouter(prefix="/rules", tags=["Rule"])


# ============================================================
# 请求/响应模型
# ============================================================

class RuleCreateRequest(BaseModel):
    scope: str = Field(..., description="作用域: global/task/sub_task")
    content: str = Field(..., description="规则内容（Markdown）")
    task_id: Optional[str] = Field(None, description="任务 ID（task/sub_task 级别时必填）")
    sub_task_id: Optional[str] = Field(None, description="子任务 ID（sub_task 级别时必填）")


class RuleUpdateRequest(BaseModel):
    content: str = Field(..., description="更新后的规则内容")


class RuleResponse(BaseModel):
    id: str
    scope: str
    task_id: Optional[str]
    sub_task_id: Optional[str]
    content: str
    created_at: Optional[dt] = None
    updated_at: Optional[dt] = None

    class Config:
        from_attributes = True


class MergedRulesResponse(BaseModel):
    content: str
    message: str = "合并后的规则（已替换变量）"


# ============================================================
# Agent 获取合并规则（核心接口）
# ============================================================

@router.get("", response_model=MergedRulesResponse, summary="获取合并后的规则")
async def get_merged_rules(
    task_id: Optional[str] = None,
    sub_task_id: Optional[str] = None,
    agent: Agent = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """获取合并后的规则提示词（全局 + 任务 + 子任务），变量已替换"""
    content = rule_service.get_merged_rules(db, task_id=task_id, sub_task_id=sub_task_id)
    return MergedRulesResponse(content=content)


# ============================================================
# 管理端 CRUD
# ============================================================

@router.get("/list", response_model=List[RuleResponse], summary="查看规则列表")
async def list_rules(
    scope: Optional[str] = None,
    task_id: Optional[str] = None,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """管理员查看规则列表"""
    return rule_service.list_rules(db, scope=scope, task_id=task_id)


@router.get("/{rule_id}", response_model=RuleResponse, summary="查看规则详情")
async def get_rule(
    rule_id: str,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """管理员查看单条规则"""
    rule = rule_service.get_rule(db, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    return rule


@router.post("", response_model=RuleResponse, summary="创建规则")
async def create_rule(
    req: RuleCreateRequest,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """管理员创建规则"""
    try:
        rule = rule_service.create_rule(
            db, scope=req.scope, content=req.content,
            task_id=req.task_id, sub_task_id=req.sub_task_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return rule


@router.put("/{rule_id}", response_model=RuleResponse, summary="更新规则")
async def update_rule(
    rule_id: str,
    req: RuleUpdateRequest,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """管理员更新规则内容"""
    try:
        rule = rule_service.update_rule(db, rule_id, req.content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return rule


@router.delete("/{rule_id}", summary="删除规则")
async def delete_rule(
    rule_id: str,
    _: bool = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """管理员删除规则"""
    try:
        rule_service.delete_rule(db, rule_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "规则已删除"}
