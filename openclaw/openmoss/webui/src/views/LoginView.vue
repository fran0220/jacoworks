<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const router = useRouter()
const auth = useAuthStore()

const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleLogin() {
    if (!password.value) {
        error.value = '请输入密码'
        return
    }
    loading.value = true
    error.value = ''
    try {
        await auth.login(password.value)
        router.push('/dashboard')
    } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } } }
        error.value = err.response?.data?.detail || '登录失败，请检查密码'
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <div class="flex min-h-screen items-center justify-center bg-background">
        <Card class="w-full max-w-sm">
            <CardHeader class="text-center">
                <div
                    class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-bold">
                    M
                </div>
                <CardTitle class="text-2xl">OpenMOSS</CardTitle>
                <CardDescription>多 AI Agent 自组织协作平台</CardDescription>
            </CardHeader>
            <CardContent>
                <form @submit.prevent="handleLogin" class="space-y-4">
                    <div class="space-y-2">
                        <Label for="password">管理员密码</Label>
                        <Input id="password" v-model="password" type="password" placeholder="请输入管理员密码"
                            :disabled="loading" @keyup.enter="handleLogin" />
                    </div>
                    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
                    <Button type="submit" class="w-full" :disabled="loading">
                        {{ loading ? '登录中...' : '登录' }}
                    </Button>
                </form>
            </CardContent>
        </Card>
    </div>
</template>
