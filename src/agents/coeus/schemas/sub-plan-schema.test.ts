import { describe, it, expect } from 'bun:test'
import { TaskSchema, SubPlanSchema } from './sub-plan-schema'

describe('TaskSchema', () => {
  //#given a valid task object
  //#when parsing with TaskSchema
  //#then it should validate successfully
  it('validates a complete task', () => {
    const task = {
      id: 'task-1',
      title: 'Implement feature',
      description: 'Add new feature to system',
      depends_on: ['task-0'],
      category: 'feature',
      skills: ['typescript', 'react'],
      files_touched: ['src/index.ts', 'src/components/Button.tsx'],
      acceptance_criteria: ['Should render without errors', 'Should pass tests'],
    }
    const result = TaskSchema.safeParse(task)
    expect(result.success).toBe(true)
  })

  //#given a task with optional fields
  //#when parsing with TaskSchema
  //#then it should validate successfully
  it('validates task with optional fields', () => {
    const task = {
      id: 'task-1',
      title: 'Implement feature',
      description: 'Add new feature to system',
      depends_on: [],
      category: 'feature',
      skills: [],
      files_touched: [],
      acceptance_criteria: ['Should work'],
      must_not_do: ['Do not break existing tests'],
      qa_scenarios: ['Test on Chrome', 'Test on Firefox'],
    }
    const result = TaskSchema.safeParse(task)
    expect(result.success).toBe(true)
  })

  //#given a task with empty title
  //#when parsing with TaskSchema
  //#then it should fail validation
  it('rejects task with empty title', () => {
    const task = {
      id: 'task-1',
      title: '',
      description: 'Add new feature to system',
      depends_on: [],
      category: 'feature',
      skills: [],
      files_touched: [],
      acceptance_criteria: ['Should work'],
    }
    const result = TaskSchema.safeParse(task)
    expect(result.success).toBe(false)
  })

  //#given a task with empty acceptance_criteria
  //#when parsing with TaskSchema
  //#then it should fail validation
  it('rejects task with empty acceptance_criteria array', () => {
    const task = {
      id: 'task-1',
      title: 'Implement feature',
      description: 'Add new feature to system',
      depends_on: [],
      category: 'feature',
      skills: [],
      files_touched: [],
      acceptance_criteria: [],
    }
    const result = TaskSchema.safeParse(task)
    expect(result.success).toBe(false)
  })

  //#given a task with empty string in acceptance_criteria
  //#when parsing with TaskSchema
  //#then it should fail validation
  it('rejects acceptance_criteria with empty strings', () => {
    const task = {
      id: 'task-1',
      title: 'Implement feature',
      description: 'Add new feature to system',
      depends_on: [],
      category: 'feature',
      skills: [],
      files_touched: [],
      acceptance_criteria: ['Valid criteria', ''],
    }
    const result = TaskSchema.safeParse(task)
    expect(result.success).toBe(false)
  })
})

describe('SubPlanSchema', () => {
  //#given a valid sub-plan object
  //#when parsing with SubPlanSchema
  //#then it should validate successfully
  it('validates a complete sub-plan', () => {
    const subPlan = {
      domain: 'authentication',
      domain_description: 'User authentication and authorization',
      tasks: [
        {
          id: 'task-1',
          title: 'Implement JWT',
          description: 'Add JWT authentication',
          depends_on: [],
          category: 'feature',
          skills: ['typescript', 'security'],
          files_touched: ['src/auth/jwt.ts'],
          acceptance_criteria: ['JWT tokens should be generated', 'JWT tokens should be validated'],
        },
      ],
      wave_assignments: { 'wave-1': 1, 'wave-2': 2 },
      constraints_acknowledged: true,
      source_sub_planner: 'session-abc123',
    }
    const result = SubPlanSchema.safeParse(subPlan)
    expect(result.success).toBe(true)
  })

  //#given a sub-plan with empty domain
  //#when parsing with SubPlanSchema
  //#then it should fail validation
  it('rejects sub-plan with empty domain', () => {
    const subPlan = {
      domain: '',
      domain_description: 'User authentication and authorization',
      tasks: [
        {
          id: 'task-1',
          title: 'Implement JWT',
          description: 'Add JWT authentication',
          depends_on: [],
          category: 'feature',
          skills: [],
          files_touched: [],
          acceptance_criteria: ['JWT tokens should be generated'],
        },
      ],
      wave_assignments: {},
      constraints_acknowledged: true,
      source_sub_planner: 'session-abc123',
    }
    const result = SubPlanSchema.safeParse(subPlan)
    expect(result.success).toBe(false)
  })

  //#given a sub-plan with empty tasks array
  //#when parsing with SubPlanSchema
  //#then it should fail validation
  it('rejects sub-plan with empty tasks array', () => {
    const subPlan = {
      domain: 'authentication',
      domain_description: 'User authentication and authorization',
      tasks: [],
      wave_assignments: {},
      constraints_acknowledged: true,
      source_sub_planner: 'session-abc123',
    }
    const result = SubPlanSchema.safeParse(subPlan)
    expect(result.success).toBe(false)
  })

   //#given a sub-plan with multiple tasks
   //#when parsing with SubPlanSchema
   //#then it should validate successfully
   it('validates sub-plan with multiple tasks', () => {
     const subPlan = {
       domain: 'database',
       domain_description: 'Database layer implementation',
       tasks: [
         {
           id: 'task-1',
           title: 'Create schema',
           description: 'Define database schema',
           depends_on: [],
           category: 'infrastructure',
           skills: ['sql'],
           files_touched: ['migrations/001_schema.sql'],
           acceptance_criteria: ['Schema should be created'],
         },
         {
           id: 'task-2',
           title: 'Add indexes',
           description: 'Add database indexes',
           depends_on: ['task-1'],
           category: 'optimization',
           skills: ['sql'],
           files_touched: ['migrations/002_indexes.sql'],
           acceptance_criteria: ['Indexes should improve query performance'],
         },
       ],
       wave_assignments: { 'wave-1': 1, 'wave-2': 1 },
       constraints_acknowledged: true,
       source_sub_planner: 'session-xyz789',
     }
     const result = SubPlanSchema.safeParse(subPlan)
     expect(result.success).toBe(true)
   })

   //#given a sub-plan without rabbit_holes or integration_touchpoints
   //#when parsing with SubPlanSchema
   //#then it should validate successfully (regression check)
   it('validates sub-plan without new optional fields', () => {
     const subPlan = {
       domain: 'authentication',
       domain_description: 'User authentication and authorization',
       tasks: [
         {
           id: 'task-1',
           title: 'Implement JWT',
           description: 'Add JWT authentication',
           depends_on: [],
           category: 'feature',
           skills: ['typescript', 'security'],
           files_touched: ['src/auth/jwt.ts'],
           acceptance_criteria: ['JWT tokens should be generated'],
         },
       ],
       wave_assignments: { 'wave-1': 1 },
       constraints_acknowledged: true,
       source_sub_planner: 'session-abc123',
     }
     const result = SubPlanSchema.safeParse(subPlan)
     expect(result.success).toBe(true)
   })

   //#given a sub-plan with rabbit_holes field
   //#when parsing with SubPlanSchema
   //#then it should validate successfully
   it('validates sub-plan with rabbit_holes', () => {
     const subPlan = {
       domain: 'authentication',
       domain_description: 'User authentication and authorization',
       tasks: [
         {
           id: 'task-1',
           title: 'Implement JWT',
           description: 'Add JWT authentication',
           depends_on: [],
           category: 'feature',
           skills: ['typescript', 'security'],
           files_touched: ['src/auth/jwt.ts'],
           acceptance_criteria: ['JWT tokens should be generated'],
         },
       ],
       wave_assignments: { 'wave-1': 1 },
       constraints_acknowledged: true,
       source_sub_planner: 'session-abc123',
       rabbit_holes: [
         {
           boundary: 'OAuth2 integration',
           description: 'Potential scope expansion to support OAuth2 providers',
           source: 'verification-record',
         },
         {
           boundary: 'Multi-factor authentication',
           description: 'Could expand to include MFA support',
         },
       ],
     }
     const result = SubPlanSchema.safeParse(subPlan)
     expect(result.success).toBe(true)
   })

   //#given a sub-plan with integration_touchpoints field
   //#when parsing with SubPlanSchema
   //#then it should validate successfully
   it('validates sub-plan with integration_touchpoints', () => {
     const subPlan = {
       domain: 'authentication',
       domain_description: 'User authentication and authorization',
       tasks: [
         {
           id: 'task-1',
           title: 'Implement JWT',
           description: 'Add JWT authentication',
           depends_on: [],
           category: 'feature',
           skills: ['typescript', 'security'],
           files_touched: ['src/auth/jwt.ts'],
           acceptance_criteria: ['JWT tokens should be generated'],
         },
       ],
       wave_assignments: { 'wave-1': 1 },
       constraints_acknowledged: true,
       source_sub_planner: 'session-abc123',
       integration_touchpoints: [
         {
           from_domain: 'authentication',
           to_domain: 'user-service',
           contract: 'POST /users/{id}/verify-token',
         },
         {
           from_domain: 'authentication',
           to_domain: 'audit-logging',
           contract: 'POST /audit/log-auth-event',
         },
       ],
     }
     const result = SubPlanSchema.safeParse(subPlan)
     expect(result.success).toBe(true)
   })

   //#given a sub-plan with both rabbit_holes and integration_touchpoints
   //#when parsing with SubPlanSchema
   //#then it should validate successfully
   it('validates sub-plan with both rabbit_holes and integration_touchpoints', () => {
     const subPlan = {
       domain: 'authentication',
       domain_description: 'User authentication and authorization',
       tasks: [
         {
           id: 'task-1',
           title: 'Implement JWT',
           description: 'Add JWT authentication',
           depends_on: [],
           category: 'feature',
           skills: ['typescript', 'security'],
           files_touched: ['src/auth/jwt.ts'],
           acceptance_criteria: ['JWT tokens should be generated'],
         },
       ],
       wave_assignments: { 'wave-1': 1 },
       constraints_acknowledged: true,
       source_sub_planner: 'session-abc123',
       rabbit_holes: [
         {
           boundary: 'OAuth2 integration',
           description: 'Potential scope expansion to support OAuth2 providers',
           source: 'verification-record',
         },
       ],
       integration_touchpoints: [
         {
           from_domain: 'authentication',
           to_domain: 'user-service',
           contract: 'POST /users/{id}/verify-token',
         },
       ],
     }
     const result = SubPlanSchema.safeParse(subPlan)
     expect(result.success).toBe(true)
   })
})
