import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, JOB_STATUS_LABELS } from "../lib/constants";
import { Button, Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label } from "@jsw/ui";
import type { Job } from "../lib/types";

/** 列表行（JobSummary）与详情（Job）共用的最小字段集 */
type JobLike = Pick<Job, "id" | "company_name" | "role_title" | "status"> & Partial<Pick<Job, "location" | "salary_text" | "source_url">>;

/** 岗位信息是否可编辑：仅优化简历之前（待分析/待优化简历）。 */
export function jobEditable(status: Job["status"]): boolean {
  return status === "pending_analysis" || status === "pending_resume_optimization";
}

/**
 * 岗位编辑弹窗（字段级）+ 删除确认弹窗。
 * 编辑受状态校验（jobEditable）；删除全局可用、不限进度。
 */
export function JobEditDialog({ job, open, onOpenChange }: {
  job: JobLike;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [company, setCompany] = useState(job.company_name);
  const [role, setRole] = useState(job.role_title);
  const [location, setLocation] = useState(job.location ?? "");
  const [salary, setSalary] = useState(job.salary_text ?? "");
  const [url, setUrl] = useState(job.source_url ?? "");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["job", job.id] });
    qc.invalidateQueries({ queryKey: ["metrics"] });
  };

  const update = useMutation({
    mutationFn: () =>
      api.updateJob(job.id, {
        company_name: company,
        role_title: role,
        location: location || null,
        salary_text: salary || null,
        source_url: url || null,
      }),
    onSuccess: () => {
      toast.success("岗位信息已更新");
      onOpenChange(false);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} ariaLabel="编辑岗位信息">
      <DialogHeader>
        <div>
          <DialogTitle>编辑岗位</DialogTitle>
          <DialogDescription>
            当前状态「{JOB_STATUS_LABELS[job.status]}」——仅优化简历之前可修改岗位信息。
          </DialogDescription>
        </div>
        <DialogCloseButton />
      </DialogHeader>
      <DialogContent>
        <div className="flex flex-col gap-3">
          <Label>
            公司名称 *
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </Label>
          <Label>
            岗位名称
            <Input value={role} onChange={(e) => setRole(e.target.value)} />
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <Label>
              地点
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </Label>
            <Label>
              薪资
              <Input value={salary} onChange={(e) => setSalary(e.target.value)} />
            </Label>
          </div>
          <Label>
            来源链接
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Label>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button onClick={() => update.mutate()} disabled={!company.trim() || update.isPending}>
          保存
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function JobDeleteDialog({ job, open, onOpenChange, onDeleted }: {
  job: JobLike;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteJob(job.id),
    onSuccess: () => {
      toast.success("岗位已删除");
      onOpenChange(false);
      onDeleted?.();
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} ariaLabel="删除岗位">
      <DialogHeader>
        <DialogTitle className="text-destructive">删除岗位</DialogTitle>
        <DialogDescription>
          将删除「{job.company_name}」的 JD 原文、分析与调研产物、沟通/投递/面试记录和事件时间线。
          已生成的岗位版简历会保留，仅解除与该岗位的关联。此操作不可撤销。
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
          删除
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
