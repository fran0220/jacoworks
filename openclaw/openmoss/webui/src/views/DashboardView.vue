<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { taskApi, agentApi, scoreApi } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ListTodo, Users, Trophy, Clock } from 'lucide-vue-next'

const stats = ref({
    totalTasks: 0,
    activeTasks: 0,
    totalAgents: 0,
    topScore: 0,
})
const loading = ref(true)

interface Task {
    status: string
    name: string
    id: string
}

onMounted(async () => {
    try {
        const [tasksRes, agentsRes, boardRes] = await Promise.all([
            taskApi.list(),
            agentApi.list(),
            scoreApi.leaderboard(),
        ])

        const tasks = (tasksRes.data.items || []) as Task[]
        stats.value.totalTasks = tasksRes.data.total || tasks.length
        stats.value.activeTasks = tasks.filter((t) => t.status === 'active').length
        stats.value.totalAgents = agentsRes.data.length
        stats.value.topScore = boardRes.data[0]?.total_score ?? 0
    } catch (e) {
        console.error('Failed to load dashboard data', e)
    } finally {
        loading.value = false
    }
})

const cards = [
    { title: '总任务数', key: 'totalTasks' as const, icon: ListTodo, color: 'text-blue-500' },
    { title: '进行中', key: 'activeTasks' as const, icon: Clock, color: 'text-amber-500' },
    { title: 'Agent 数量', key: 'totalAgents' as const, icon: Users, color: 'text-emerald-500' },
    { title: '最高积分', key: 'topScore' as const, icon: Trophy, color: 'text-purple-500' },
]
</script>

<template>
    <div class="space-y-6">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card v-for="card in cards" :key="card.key">
                <CardHeader class="flex flex-row items-center justify-between pb-2">
                    <CardTitle class="text-sm font-medium text-muted-foreground">
                        {{ card.title }}
                    </CardTitle>
                    <component :is="card.icon" class="h-4 w-4" :class="card.color" />
                </CardHeader>
                <CardContent>
                    <div v-if="loading" class="h-8 w-16 animate-pulse rounded bg-muted" />
                    <div v-else class="text-2xl font-bold">{{ stats[card.key] }}</div>
                </CardContent>
            </Card>
        </div>
    </div>
</template>
