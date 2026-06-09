/**
 * Venue-Specific Rubric Database for Academic Paper Review Agent
 *
 * Contains scoring criteria, weight distributions, acceptance rates,
 * and specific requirements for top-tier journals and conferences.
 */

export interface RubricDimension {
  name: string
  weight: number // 0-1, sum must equal 1
  description: string
  criteria: Record<string, string> // score_range -> description
}

export interface VenueRubric {
  name: string
  type: "journal" | "conference"
  publisher: string
  impactFactor?: number
  acceptanceRate?: string
  h5Index?: number
  reviewTimeline: string
  dimensions: RubricDimension[]
  specialRequirements: string[]
  commonRejectionReasons: string[]
  noveltyBar: "paradigm-shifting" | "high" | "moderate" | "incremental"
}

// ============================================================================
// SCORING CRITERIA TEMPLATES
// ============================================================================

const NOVELTY_CRITERIA: Record<string, string> = {
  "9-10": "Paradigm-shifting contribution; opens new research direction",
  "7-8": "Significant advance over state-of-the-art; clear novel contribution",
  "5-6": "Incremental but solid contribution; extends existing work meaningfully",
  "3-4": "Minor contribution; marginal improvement over existing methods",
  "1-2": "No novelty; rehash of existing work or trivial extension",
}

const TECHNICAL_CRITERIA: Record<string, string> = {
  "9-10": "Rigorous methodology; flawless execution; strong theoretical foundation",
  "7-8": "Sound methodology; minor issues that don't affect conclusions",
  "5-6": "Acceptable methodology; some concerns but core claims supported",
  "3-4": "Significant methodological issues; conclusions may not hold",
  "1-2": "Fundamentally flawed; conclusions unsupported or contradicted",
}

const PRESENTATION_CRITERIA: Record<string, string> = {
  "9-10": "Exceptionally clear; well-structured; publication-ready",
  "7-8": "Clear and well-organized; minor editorial issues",
  "5-6": "Understandable but could be improved; some unclear sections",
  "3-4": "Poorly organized; significant clarity issues",
  "1-2": "Very difficult to understand; major restructuring needed",
}

const REPRODUCIBILITY_CRITERIA: Record<string, string> = {
  "9-10": "Fully reproducible; code/data available; all details provided",
  "7-8": "Mostly reproducible; minor details missing but can be inferred",
  "5-6": "Partially reproducible; key details present but gaps exist",
  "3-4": "Difficult to reproduce; significant information missing",
  "1-2": "Not reproducible; insufficient detail to verify claims",
}

const IMPACT_CRITERIA: Record<string, string> = {
  "9-10": "High expected impact; will influence multiple research groups",
  "7-8": "Significant impact expected; relevant to many researchers",
  "5-6": "Moderate impact; useful to specialists in the area",
  "3-4": "Limited impact; niche contribution with narrow applicability",
  "1-2": "Minimal impact; unlikely to influence future work",
}

// ============================================================================
// JOURNAL RUBRICS
// ============================================================================

export const JOURNAL_RUBRICS: Record<string, VenueRubric> = {
  // --------------------------------------------------------------------------
  // NATURE / SCIENCE / CELL — Paradigm-shifting only
  // --------------------------------------------------------------------------
  nature: {
    name: "Nature",
    type: "journal",
    publisher: "Springer Nature",
    impactFactor: 64.8,
    acceptanceRate: "~7-8%",
    reviewTimeline: "2-4 weeks initial decision",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.35,
        description: "Must be paradigm-shifting or field-defining",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Methodology must be impeccable",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Broad Impact",
        weight: 0.20,
        description: "Must appeal to broad scientific audience",
        criteria: IMPACT_CRITERIA,
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Must be exceptionally clear for non-specialists",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.10,
        description: "Data and methods must be available",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Must demonstrate significance to non-specialist readers",
      "Strong narrative arc required",
      "Limited to ~5,000 words for Article format",
      "Extended data and supplementary information expected",
    ],
    commonRejectionReasons: [
      "Not sufficiently novel or groundbreaking",
      "Too specialized for broad readership",
      "Incremental advance rather than paradigm shift",
      "Methodological concerns that undermine conclusions",
    ],
    noveltyBar: "paradigm-shifting",
  },

  // --------------------------------------------------------------------------
  // MDPI Sensors
  // --------------------------------------------------------------------------
  mdpi_sensors: {
    name: "Sensors",
    type: "journal",
    publisher: "MDPI",
    impactFactor: 3.5,
    acceptanceRate: "~44%",
    reviewTimeline: "2-4 weeks to first decision",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel sensor technology or application",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound sensor design, implementation, or analysis",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Sensor performance evaluation with real data",
        criteria: {
          "9-10": "Real-world sensor deployment; comprehensive performance analysis",
          "7-8": "Good experimental setup; standard sensor benchmarks",
          "5-6": "Adequate experiments; limited sensor characterization",
          "3-4": "Weak experiments; insufficient sensor validation",
          "1-2": "No meaningful sensor experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear sensor system description",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Sensor design and experimental setup details",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Focus on sensor technology, IoT, or sensor networks",
      "Fully open access (APC ~$2,900)",
      "Fast review timeline (~5 weeks total)",
      "Indexed in SCIE, Scopus, PubMed",
    ],
    commonRejectionReasons: [
      "Insufficient novelty in sensor design or application",
      "Weak experimental validation",
      "Incremental improvement over existing sensors",
      "Poor sensor characterization",
    ],
    noveltyBar: "incremental",
  },

  // --------------------------------------------------------------------------
  // MDPI Remote Sensing
  // --------------------------------------------------------------------------
  mdpi_remote_sensing: {
    name: "Remote Sensing",
    type: "journal",
    publisher: "MDPI",
    impactFactor: 4.2,
    acceptanceRate: "~40-45%",
    reviewTimeline: "2-4 weeks to first decision",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel remote sensing methods or applications",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound remote sensing methodology",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Validation with remote sensing data and benchmarks",
        criteria: {
          "9-10": "Multiple remote sensing datasets; comprehensive validation; real-world application",
          "7-8": "Standard RS benchmarks; good comparison",
          "5-6": "Limited RS datasets; adequate validation",
          "3-4": "Weak RS validation; insufficient data",
          "1-2": "No meaningful RS experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear figures and remote sensing visualizations",
        criteria: {
          "9-10": "Exceptional RS figures; clear spatial visualizations",
          "7-8": "Good RS figures; clear presentation",
          "5-6": "Adequate figures; some unclear visualizations",
          "3-4": "Poor RS figures; hard to interpret",
          "1-2": "Very poor visual presentation",
        },
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Remote sensing data sources and processing details",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Focus on remote sensing, geoscience, or spatial analysis",
      "Fully open access (APC ~$2,700)",
      "Fast review timeline (~6-10 weeks total)",
      "5,000+ papers/year; Q1-Q2 in geosciences",
    ],
    commonRejectionReasons: [
      "Insufficient remote sensing contribution",
      "Weak spatial analysis or validation",
      "Incremental improvement",
      "Poor figure quality for RS data",
    ],
    noveltyBar: "incremental",
  },

  // --------------------------------------------------------------------------
  // MDPI Applied Sciences
  // --------------------------------------------------------------------------
  mdpi_applied_sciences: {
    name: "Applied Sciences",
    type: "journal",
    publisher: "MDPI",
    impactFactor: 2.5,
    acceptanceRate: "~45-50%",
    reviewTimeline: "2-4 weeks to first decision",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel applied science contribution",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound methodology in applied sciences",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Practical validation of applied methods",
        criteria: {
          "9-10": "Real-world application; comprehensive validation",
          "7-8": "Good experiments; practical context",
          "5-6": "Standard experiments; some application",
          "3-4": "Limited validation",
          "1-2": "No meaningful experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear and well-organized",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Sufficient detail for replication",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Broad scope: all aspects of applied natural sciences",
      "Fully open access (APC ~$2,400)",
      "Fast review timeline",
      "Semimonthly publication schedule",
    ],
    commonRejectionReasons: [
      "Insufficient novelty or contribution",
      "Weak experimental validation",
      "Out of scope for applied sciences",
      "Poor writing quality",
    ],
    noveltyBar: "incremental",
  },

  // --------------------------------------------------------------------------
  // MDPI Mathematics
  // --------------------------------------------------------------------------
  mdpi_mathematics: {
    name: "Mathematics",
    type: "journal",
    publisher: "MDPI",
    impactFactor: 2.3,
    acceptanceRate: "~45-50%",
    reviewTimeline: "2-4 weeks to first decision",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel mathematical contribution or application",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.30,
        description: "Mathematical rigor and correctness",
        criteria: {
          "9-10": "Rigorous proofs; flawless mathematical reasoning",
          "7-8": "Sound proofs; minor issues",
          "5-6": "Acceptable rigor; some gaps in reasoning",
          "3-4": "Significant mathematical issues",
          "1-2": "Fundamentally flawed proofs",
        },
      },
      {
        name: "Experimental Validation",
        weight: 0.15,
        description: "Numerical validation or examples",
        criteria: {
          "9-10": "Comprehensive numerical examples; theoretical + computational validation",
          "7-8": "Good numerical examples; standard test problems",
          "5-6": "Adequate examples; limited scope",
          "3-4": "Weak numerical validation",
          "1-2": "No numerical examples",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear mathematical exposition",
        criteria: {
          "9-10": "Exceptionally clear; well-structured proofs; good notation",
          "7-8": "Clear exposition; minor issues",
          "5-6": "Understandable but could be improved",
          "3-4": "Poorly organized; unclear proofs",
          "1-2": "Very difficult to follow",
        },
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Sufficient detail for mathematical verification",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Q1 in Mathematics; broad mathematical scope",
      "Fully open access (APC ~$2,300)",
      "Mathematical rigor required for all claims",
    ],
    commonRejectionReasons: [
      "Insufficient mathematical novelty",
      "Gaps in proofs or mathematical reasoning",
      "Incremental contribution",
      "Poor mathematical exposition",
    ],
    noveltyBar: "incremental",
  },

  // --------------------------------------------------------------------------
  // MDPI Energies
  // --------------------------------------------------------------------------
  mdpi_energies: {
    name: "Energies",
    type: "journal",
    publisher: "MDPI",
    impactFactor: 3.2,
    acceptanceRate: "~45-50%",
    reviewTimeline: "2-4 weeks to first decision",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel energy systems or methods",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound energy engineering methodology",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Energy system validation with real or simulated data",
        criteria: {
          "9-10": "Real energy system data; comprehensive validation; industry collaboration",
          "7-8": "Good energy benchmarks; realistic simulations",
          "5-6": "Standard energy datasets; adequate validation",
          "3-4": "Weak validation; insufficient energy data",
          "1-2": "No meaningful energy experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear energy system description",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Energy system parameters and experimental setup",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Focus on energy: renewable, fossil, nuclear, efficiency, storage, grids",
      "Fully open access (APC ~$2,600)",
      "Practical energy applications preferred",
    ],
    commonRejectionReasons: [
      "Insufficient energy contribution",
      "Weak energy system validation",
      "Incremental improvement",
      "Poor experimental design",
    ],
    noveltyBar: "incremental",
  },

  // --------------------------------------------------------------------------
  // MDPI Drones
  // --------------------------------------------------------------------------
  mdpi_drones: {
    name: "Drones",
    type: "journal",
    publisher: "MDPI",
    impactFactor: 4.8,
    acceptanceRate: "~40-45%",
    reviewTimeline: "2-4 weeks to first decision",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel drone/UAV technology or application",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound drone systems methodology",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Drone flight tests or realistic simulations",
        criteria: {
          "9-10": "Real drone deployment; flight tests; comprehensive field validation",
          "7-8": "Good simulations; realistic drone scenarios",
          "5-6": "Standard benchmarks; limited drone testing",
          "3-4": "Weak validation; no real drone data",
          "1-2": "No meaningful drone experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear drone system description with figures",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Drone specifications and experimental setup",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Focus on drones/UAVs: navigation, control, sensing, communication, applications",
      "Fully open access (APC ~$2,700)",
      "Real flight data preferred over pure simulation",
      "Q2 in Remote Sensing",
    ],
    commonRejectionReasons: [
      "No real drone application or testing",
      "Incremental drone improvement",
      "Weak experimental validation",
      "Out of scope for drone systems",
    ],
    noveltyBar: "moderate",
  },

  // --------------------------------------------------------------------------
  // IEEE TPAMI — Top AI/CV journal
  // --------------------------------------------------------------------------
  ieee_tpami: {
    name: "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    type: "journal",
    publisher: "IEEE",
    impactFactor: 24.3,
    acceptanceRate: "~15-20%",
    reviewTimeline: "3-6 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Major advance in pattern analysis or machine intelligence",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.30,
        description: "Rigorous mathematical foundation and experimental validation",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Comprehensive experiments on standard benchmarks",
        criteria: {
          "9-10": "Extensive experiments; multiple benchmarks; thorough ablation",
          "7-8": "Good experimental coverage; standard benchmarks used",
          "5-6": "Adequate experiments; some benchmarks missing",
          "3-4": "Limited experiments; key benchmarks not included",
          "1-2": "Insufficient experimental validation",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear writing; proper mathematical notation",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Code and detailed implementation expected",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Strong theoretical contribution preferred",
      "Comparison with state-of-the-art on standard benchmarks required",
      "Ablation studies expected",
      "Mathematical proofs for theoretical claims",
    ],
    commonRejectionReasons: [
      "Incremental improvement over existing methods",
      "Insufficient experimental comparison",
      "Lack of theoretical contribution",
      "Poor writing quality or organization",
    ],
    noveltyBar: "high",
  },

  // --------------------------------------------------------------------------
  // ACM Computing Surveys — Comprehensive surveys
  // --------------------------------------------------------------------------
  acm_computing_surveys: {
    name: "ACM Computing Surveys",
    type: "journal",
    publisher: "ACM",
    impactFactor: 16.6,
    acceptanceRate: "~20%",
    reviewTimeline: "3-6 months",
    dimensions: [
      {
        name: "Comprehensiveness",
        weight: 0.30,
        description: "Must cover the field exhaustively",
        criteria: {
          "9-10": "Definitive survey; covers all important work",
          "7-8": "Comprehensive; most important work covered",
          "5-6": "Adequate coverage; some important work missing",
          "3-4": "Incomplete; significant gaps in coverage",
          "1-2": "Major topics omitted; not a useful survey",
        },
      },
      {
        name: "Analysis & Synthesis",
        weight: 0.25,
        description: "Must provide novel taxonomy and insights",
        criteria: {
          "9-10": "Novel taxonomy; deep insights; identifies open problems",
          "7-8": "Good organization; useful comparisons and insights",
          "5-6": "Standard organization; limited new insights",
          "3-4": "Poor organization; mostly descriptive",
          "1-2": "No synthesis; just a list of papers",
        },
      },
      {
        name: "Technical Accuracy",
        weight: 0.20,
        description: "Must accurately represent cited work",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Must be accessible to researchers at all levels",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Currency",
        weight: 0.10,
        description: "Must include recent developments",
        criteria: {
          "9-10": "Covers work up to submission date",
          "7-8": "Mostly current; minor gaps",
          "5-6": "Some outdated references",
          "3-4": "Significant recent work missing",
          "1-2": "Outdated; misses major recent advances",
        },
      },
    ],
    specialRequirements: [
      "Must provide novel taxonomy or classification scheme",
      "Identify open research problems",
      "Compare methods across multiple dimensions",
      "Typically 30-50 pages",
    ],
    commonRejectionReasons: [
      "Insufficient coverage of the field",
      "No novel insights or taxonomy",
      "Inaccurate representation of cited work",
      "Too narrow or too broad scope",
    ],
    noveltyBar: "moderate",
  },

  // --------------------------------------------------------------------------
  // Elsevier Information Sciences
  // --------------------------------------------------------------------------
  elsevier_information_sciences: {
    name: "Information Sciences",
    type: "journal",
    publisher: "Elsevier",
    impactFactor: 8.1,
    acceptanceRate: "~20-25%",
    reviewTimeline: "2-4 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Solid contribution to information sciences",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.30,
        description: "Rigorous methodology and validation",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Thorough empirical evaluation",
        criteria: {
          "9-10": "Comprehensive experiments with statistical analysis",
          "7-8": "Good experimental design; standard benchmarks",
          "5-6": "Adequate experiments; some gaps",
          "3-4": "Limited experiments; weak validation",
          "1-2": "Insufficient empirical evidence",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear and well-organized",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.10,
        description: "Sufficient detail for replication",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Clear problem statement and motivation",
      "Comparison with relevant baselines",
      "Statistical significance testing expected",
    ],
    commonRejectionReasons: [
      "Incremental contribution",
      "Insufficient experimental comparison",
      "Weak motivation or problem statement",
      "Poor writing quality",
    ],
    noveltyBar: "moderate",
  },

  // --------------------------------------------------------------------------
  // Springer Machine Learning
  // --------------------------------------------------------------------------
  springer_ai_review: {
    name: "Artificial Intelligence Review",
    type: "journal",
    publisher: "Springer",
    impactFactor: 13.9,
    acceptanceRate: "~15-20%",
    reviewTimeline: "3-6 months",
    dimensions: [
      {
        name: "Comprehensiveness",
        weight: 0.25,
        description: "Must cover the AI subfield thoroughly",
        criteria: {
          "9-10": "Definitive review; covers all important work in the area",
          "7-8": "Comprehensive; most important work covered",
          "5-6": "Adequate coverage; some important work missing",
          "3-4": "Incomplete; significant gaps in coverage",
          "1-2": "Major topics omitted; not a useful review",
        },
      },
      {
        name: "Analysis & Synthesis",
        weight: 0.25,
        description: "Must provide novel taxonomy and critical insights",
        criteria: {
          "9-10": "Novel taxonomy; deep critical analysis; identifies open problems",
          "7-8": "Good organization; useful comparisons and insights",
          "5-6": "Standard organization; limited new insights",
          "3-4": "Poor organization; mostly descriptive",
          "1-2": "No synthesis; just a list of papers",
        },
      },
      {
        name: "Technical Accuracy",
        weight: 0.20,
        description: "Must accurately represent cited work",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Must be accessible to AI researchers at all levels",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Currency",
        weight: 0.15,
        description: "Must include recent AI developments",
        criteria: {
          "9-10": "Covers work up to submission date; includes latest advances",
          "7-8": "Mostly current; minor gaps",
          "5-6": "Some outdated references",
          "3-4": "Significant recent work missing",
          "1-2": "Outdated; misses major recent advances",
        },
      },
    ],
    specialRequirements: [
      "Must provide novel taxonomy or classification scheme for AI area",
      "Identify open research problems and future directions",
      "Critical analysis required, not just description",
      "Fully open access journal",
    ],
    commonRejectionReasons: [
      "Insufficient coverage of the AI subfield",
      "No novel insights or taxonomy",
      "Inaccurate representation of cited work",
      "Too narrow or too broad scope",
      "Descriptive rather than analytical",
    ],
    noveltyBar: "high",
  },

  springer_nca: {
    name: "Neural Computing and Applications",
    type: "journal",
    publisher: "Springer",
    impactFactor: 6.5,
    acceptanceRate: "~25-30%",
    reviewTimeline: "3-6 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel neural computing methods or practical applications",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound methodology in neural computing",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Practical application validation with benchmarks or real-world data",
        criteria: {
          "9-10": "Real-world deployment; multiple case studies; statistical analysis",
          "7-8": "Good benchmarks; practical application context",
          "5-6": "Standard benchmarks; limited application",
          "3-4": "Synthetic data; weak practical relevance",
          "1-2": "No meaningful validation",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear description of neural computing approach",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Detailed implementation for practical systems",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Focus on practical applications of neural computing",
      "Related techniques: genetic algorithms, fuzzy logic, neuro-fuzzy systems",
      "Case histories of innovative applications welcome",
    ],
    commonRejectionReasons: [
      "Purely theoretical without practical application",
      "Incremental neural network improvement",
      "Weak experimental validation",
      "Poor writing quality",
    ],
    noveltyBar: "moderate",
  },

  springer_applied_intelligence: {
    name: "Applied Intelligence",
    type: "journal",
    publisher: "Springer",
    impactFactor: 3.5,
    acceptanceRate: "~30-35%",
    reviewTimeline: "3-6 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel AI methods addressing real-world problems",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound AI methodology",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Validation on real or realistic problems",
        criteria: {
          "9-10": "Real-world application; comprehensive validation",
          "7-8": "Good benchmarks; practical context",
          "5-6": "Standard benchmarks; some application",
          "3-4": "Limited validation",
          "1-2": "No meaningful experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear and well-organized",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Sufficient detail for replication",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Address real and complex problems requiring unconventional approaches",
      "New and original research and technological developments",
      "30+ years of publishing history",
    ],
    commonRejectionReasons: [
      "No clear real-world application",
      "Incremental contribution",
      "Weak experimental evaluation",
      "Poor presentation",
    ],
    noveltyBar: "moderate",
  },

  springer_machine_learning: {
    name: "Machine Learning",
    type: "journal",
    publisher: "Springer",
    impactFactor: 7.5,
    acceptanceRate: "~20%",
    reviewTimeline: "3-6 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel machine learning methods or theory",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.30,
        description: "Mathematical rigor and theoretical foundation",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Empirical validation on relevant tasks",
        criteria: {
          "9-10": "Extensive experiments; multiple domains; ablation studies",
          "7-8": "Good experiments; standard benchmarks; some ablation",
          "5-6": "Adequate experiments; limited ablation",
          "3-4": "Weak experiments; insufficient validation",
          "1-2": "No meaningful experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear exposition with proper notation",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Code availability and detailed methodology",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Theoretical contribution preferred but not required",
      "Comparison with strong baselines",
      "Ablation studies for complex methods",
    ],
    commonRejectionReasons: [
      "Purely empirical without theoretical insight",
      "Insufficient comparison with existing work",
      "Incremental improvement",
      "Weak experimental design",
    ],
    noveltyBar: "high",
  },

  // --------------------------------------------------------------------------
  // Elsevier Expert Systems with Applications
  // --------------------------------------------------------------------------
  elsevier_eswa: {
    name: "Expert Systems with Applications",
    type: "journal",
    publisher: "Elsevier",
    impactFactor: 7.5,
    acceptanceRate: "~20-25%",
    reviewTimeline: "2-4 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel expert/intelligent system with practical application",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound methodology with proper system design",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Real-world application or realistic benchmarks",
        criteria: {
          "9-10": "Real-world deployment; multiple case studies; statistical analysis",
          "7-8": "Realistic benchmarks; good comparison with baselines",
          "5-6": "Standard benchmarks; some application context",
          "3-4": "Synthetic data only; weak validation",
          "1-2": "No meaningful experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear system description and architecture",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "System details sufficient for implementation",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Must demonstrate practical application or system implementation",
      "Comparison with relevant baselines required",
      "Clear system architecture description",
      "Real-world or realistic experimental setup preferred",
    ],
    commonRejectionReasons: [
      "No practical application demonstrated",
      "Incremental improvement over existing systems",
      "Weak experimental evaluation",
      "Poor system design or architecture",
    ],
    noveltyBar: "moderate",
  },

  // --------------------------------------------------------------------------
  // Elsevier Knowledge-Based Systems
  // --------------------------------------------------------------------------
  elsevier_kbs: {
    name: "Knowledge-Based Systems",
    type: "journal",
    publisher: "Elsevier",
    impactFactor: 7.6,
    acceptanceRate: "~20-25%",
    reviewTimeline: "2-4 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel knowledge-based or AI methodology",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.30,
        description: "Rigorous AI/knowledge methodology",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Thorough empirical evaluation on knowledge tasks",
        criteria: {
          "9-10": "Comprehensive experiments; multiple domains; ablation studies",
          "7-8": "Good experiments; standard benchmarks; some ablation",
          "5-6": "Adequate experiments; limited ablation",
          "3-4": "Weak experiments; insufficient validation",
          "1-2": "No meaningful experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear writing with proper AI terminology",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Detailed methodology for knowledge system replication",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Focus on knowledge-based systems, AI, or intelligent systems",
      "Theoretical or empirical contribution to AI field",
      "Comparison with state-of-the-art methods",
    ],
    commonRejectionReasons: [
      "Not sufficiently related to knowledge-based systems",
      "Incremental contribution to AI",
      "Weak experimental validation",
      "Poor writing quality",
    ],
    noveltyBar: "moderate",
  },

  // --------------------------------------------------------------------------
  // Elsevier Neurocomputing
  // --------------------------------------------------------------------------
  elsevier_neurocomputing: {
    name: "Neurocomputing",
    type: "journal",
    publisher: "Elsevier",
    impactFactor: 6.5,
    acceptanceRate: "~25-30%",
    reviewTimeline: "2-4 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel neurocomputing methods or applications",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound neural network methodology",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Comprehensive experiments on neural computing tasks",
        criteria: {
          "9-10": "Extensive experiments; multiple benchmarks; theoretical + empirical",
          "7-8": "Good experiments; standard benchmarks",
          "5-6": "Adequate experiments; some gaps",
          "3-4": "Limited experiments; weak validation",
          "1-2": "Insufficient experimental evidence",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear and well-organized",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Code and detailed implementation expected",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Focus on neural computing theory, practice, or applications",
      "Neural network architectures, learning algorithms, or applications",
      "Comparison with relevant baselines",
    ],
    commonRejectionReasons: [
      "Incremental neural network improvement",
      "Insufficient experiments",
      "Weak theoretical contribution",
      "Poor presentation",
    ],
    noveltyBar: "moderate",
  },

  // --------------------------------------------------------------------------
  // Elsevier Applied Soft Computing
  // --------------------------------------------------------------------------
  elsevier_asc: {
    name: "Applied Soft Computing",
    type: "journal",
    publisher: "Elsevier",
    impactFactor: 6.6,
    acceptanceRate: "~20-25%",
    reviewTimeline: "2-4 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel soft computing methods with practical application",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound methodology in fuzzy logic, neural networks, or evolutionary computing",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Real-world or benchmark validation of soft computing methods",
        criteria: {
          "9-10": "Real-world applications; multiple case studies; statistical validation",
          "7-8": "Good benchmarks; practical application context",
          "5-6": "Standard benchmarks; limited application",
          "3-4": "Synthetic data; weak practical relevance",
          "1-2": "No meaningful validation",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear description of soft computing approach",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Sufficient detail for method replication",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Focus on soft computing: fuzzy logic, neural networks, evolutionary computation, hybrid systems",
      "Practical application or real-world problem solving preferred",
      "Nature-inspired algorithms must demonstrate genuine novelty beyond metaphor renaming",
    ],
    commonRejectionReasons: [
      "Nature-inspired algorithm without genuine novelty",
      "Weak practical application",
      "Incremental improvement",
      "Insufficient experiments",
    ],
    noveltyBar: "moderate",
  },

  // --------------------------------------------------------------------------
  // Elsevier Engineering Applications of Artificial Intelligence
  // --------------------------------------------------------------------------
  elsevier_eaai: {
    name: "Engineering Applications of Artificial Intelligence",
    type: "journal",
    publisher: "Elsevier",
    impactFactor: 8.0,
    acceptanceRate: "~20%",
    reviewTimeline: "2-4 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.20,
        description: "Novel AI application to engineering problems",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound AI methodology applied to engineering",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.30,
        description: "Engineering validation with real-world data or realistic simulations",
        criteria: {
          "9-10": "Real engineering deployment; industry data; comprehensive validation",
          "7-8": "Realistic engineering benchmarks; good comparison",
          "5-6": "Standard benchmarks; some engineering context",
          "3-4": "Synthetic data; weak engineering relevance",
          "1-2": "No engineering validation",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear for both AI and engineering audiences",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Engineering details and AI implementation",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Must demonstrate AI application to engineering domain",
      "Real-world engineering data or realistic simulations preferred",
      "Bridge between AI methods and engineering practice",
    ],
    commonRejectionReasons: [
      "No clear engineering application",
      "AI method applied without engineering insight",
      "Weak experimental validation",
      "Incremental contribution",
    ],
    noveltyBar: "moderate",
  },

  // --------------------------------------------------------------------------
  // IEEE TNNLS — Neural Networks and Learning Systems
  // --------------------------------------------------------------------------
  ieee_tnnls: {
    name: "IEEE Transactions on Neural Networks and Learning Systems",
    type: "journal",
    publisher: "IEEE",
    impactFactor: 10.4,
    acceptanceRate: "~25%",
    reviewTimeline: "2-4 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel neural network architectures or learning algorithms",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.30,
        description: "Rigorous mathematical analysis",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Comprehensive empirical evaluation",
        criteria: {
          "9-10": "Extensive experiments; theoretical + empirical validation",
          "7-8": "Good experiments; standard benchmarks",
          "5-6": "Adequate experiments; some gaps",
          "3-4": "Limited experiments",
          "1-2": "Insufficient validation",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear and well-structured",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Detailed implementation and code availability",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Theoretical analysis preferred",
      "Comparison with state-of-the-art methods",
      "Statistical significance testing",
    ],
    commonRejectionReasons: [
      "Lack of theoretical contribution",
      "Insufficient experiments",
      "Incremental improvement",
      "Poor presentation quality",
    ],
    noveltyBar: "high",
  },
}

// ============================================================================
// CONFERENCE RUBRICS
// ============================================================================

export const CONFERENCE_RUBRICS: Record<string, VenueRubric> = {
  // --------------------------------------------------------------------------
  // NeurIPS — Top ML conference
  // --------------------------------------------------------------------------
  neurips: {
    name: "NeurIPS",
    type: "conference",
    publisher: "NeurIPS Foundation",
    acceptanceRate: "~25-28%",
    h5Index: 350,
    reviewTimeline: "2-3 months (rebuttal period included)",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.30,
        description: "High novelty bar; must advance the field",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Rigorous methodology and proofs",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Strong empirical results with ablation",
        criteria: {
          "9-10": "Comprehensive experiments; multiple benchmarks; thorough ablation",
          "7-8": "Good experiments; standard benchmarks; some ablation",
          "5-6": "Adequate experiments; limited ablation",
          "3-4": "Weak experiments; insufficient validation",
          "1-2": "No meaningful experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear and concise (8-page limit)",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Code strongly encouraged; appendix for details",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "8-page limit (excluding references and appendix)",
      "Rebuttal period for responding to reviews",
      "Code submission strongly encouraged",
      "Broader impact statement required",
    ],
    commonRejectionReasons: [
      "Insufficient novelty for top venue",
      "Weak experimental evaluation",
      "Incremental improvement over existing work",
      "Poor writing or organization",
      "Missing ablation studies",
    ],
    noveltyBar: "high",
  },

  // --------------------------------------------------------------------------
  // ICML — International Conference on Machine Learning
  // --------------------------------------------------------------------------
  icml: {
    name: "ICML",
    type: "conference",
    publisher: "ICML",
    acceptanceRate: "~25-28%",
    h5Index: 300,
    reviewTimeline: "2-3 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.30,
        description: "Significant contribution to machine learning",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.30,
        description: "Theoretical rigor preferred; strong proofs",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Solid empirical validation",
        criteria: {
          "9-10": "Extensive experiments; theoretical + empirical",
          "7-8": "Good experiments; standard benchmarks",
          "5-6": "Adequate experiments",
          "3-4": "Weak experiments",
          "1-2": "Insufficient",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear exposition",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.10,
        description: "Code availability; detailed methodology",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "9-page limit (excluding references and appendix)",
      "Theoretical contributions valued highly",
      "Rebuttal period available",
    ],
    commonRejectionReasons: [
      "Lack of theoretical insight",
      "Weak experimental evaluation",
      "Incremental contribution",
      "Unclear presentation",
    ],
    noveltyBar: "high",
  },

  // --------------------------------------------------------------------------
  // ICLR — International Conference on Learning Representations
  // --------------------------------------------------------------------------
  iclr: {
    name: "ICLR",
    type: "conference",
    publisher: "ICLR",
    acceptanceRate: "~25-30%",
    h5Index: 280,
    reviewTimeline: "2-3 months (open review)",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.30,
        description: "Novel representation learning methods",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound methodology and analysis",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.20,
        description: "Strong empirical results",
        criteria: {
          "9-10": "Comprehensive experiments; clear improvements",
          "7-8": "Good experiments; standard benchmarks",
          "5-6": "Adequate experiments",
          "3-4": "Weak experiments",
          "1-2": "Insufficient",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear and accessible",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Open review; code expected",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "Open review process (reviews are public)",
      "9-page limit",
      "Code submission expected",
      "Rebuttal and discussion period",
    ],
    commonRejectionReasons: [
      "Insufficient novelty",
      "Weak experimental validation",
      "Incremental contribution",
      "Poor presentation",
    ],
    noveltyBar: "high",
  },

  // --------------------------------------------------------------------------
  // ACL — Association for Computational Linguistics
  // --------------------------------------------------------------------------
  acl: {
    name: "ACL",
    type: "conference",
    publisher: "ACL",
    acceptanceRate: "~20-25%",
    h5Index: 200,
    reviewTimeline: "2-3 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel NLP methods or insights",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound methodology for NLP tasks",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Standard NLP benchmarks; error analysis",
        criteria: {
          "9-10": "Multiple benchmarks; error analysis; human evaluation",
          "7-8": "Standard benchmarks; some error analysis",
          "5-6": "Limited benchmarks; no error analysis",
          "3-4": "Weak evaluation; single benchmark",
          "1-2": "Insufficient evaluation",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear writing; proper NLP conventions",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Code and data availability",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "8-page limit (excluding references)",
      "Error analysis expected",
      "Human evaluation for generation tasks",
      "Comparison with strong baselines",
    ],
    commonRejectionReasons: [
      "Insufficient novelty for NLP",
      "Weak experimental evaluation",
      "Missing error analysis",
      "Incremental improvement",
    ],
    noveltyBar: "high",
  },

  // --------------------------------------------------------------------------
  // CVPR — Computer Vision and Pattern Recognition
  // --------------------------------------------------------------------------
  cvpr: {
    name: "CVPR",
    type: "conference",
    publisher: "IEEE/CVF",
    acceptanceRate: "~25%",
    h5Index: 320,
    reviewTimeline: "2-3 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel CV methods or architectures",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.20,
        description: "Sound methodology; proper architecture design",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.30,
        description: "Standard CV benchmarks; visual results",
        criteria: {
          "9-10": "Multiple benchmarks; visual comparisons; ablation; SOTA results",
          "7-8": "Standard benchmarks; visual results; some ablation",
          "5-6": "Limited benchmarks; weak visual evidence",
          "3-4": "Insufficient experiments",
          "1-2": "No meaningful experiments",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear figures; visual results quality",
        criteria: {
          "9-10": "Exceptional figures; clear visual comparisons",
          "7-8": "Good figures; clear presentation",
          "5-6": "Adequate figures; some unclear visuals",
          "3-4": "Poor figures; hard to evaluate visually",
          "1-2": "Very poor visual presentation",
        },
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Code expected; model weights encouraged",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "8-page limit",
      "Visual results must be convincing",
      "Standard CV benchmarks required (ImageNet, COCO, etc.)",
      "Code submission encouraged",
    ],
    commonRejectionReasons: [
      "Weak visual results",
      "Insufficient experiments on standard benchmarks",
      "Incremental improvement",
      "Missing ablation studies",
    ],
    noveltyBar: "high",
  },

  // --------------------------------------------------------------------------
  // AAAI — Association for the Advancement of AI
  // --------------------------------------------------------------------------
  aaai: {
    name: "AAAI",
    type: "conference",
    publisher: "AAAI",
    acceptanceRate: "~20-25%",
    h5Index: 180,
    reviewTimeline: "2-3 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel AI contribution with clear problem",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound methodology and analysis",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Solid empirical evaluation",
        criteria: {
          "9-10": "Comprehensive experiments; multiple datasets; ablation",
          "7-8": "Good experiments; standard benchmarks",
          "5-6": "Adequate experiments",
          "3-4": "Weak experiments",
          "1-2": "Insufficient",
        },
      },
      {
        name: "Presentation",
        weight: 0.15,
        description: "Clear problem statement and solution",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.10,
        description: "Sufficient detail for replication",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "7-page limit (excluding references)",
      "Clear problem statement required",
      "Broader AI audience",
    ],
    commonRejectionReasons: [
      "Unclear problem statement",
      "Weak experimental evaluation",
      "Incremental contribution",
      "Poor presentation",
    ],
    noveltyBar: "high",
  },

  // --------------------------------------------------------------------------
  // EMNLP — Empirical Methods in NLP
  // --------------------------------------------------------------------------
  emnlp: {
    name: "EMNLP",
    type: "conference",
    publisher: "ACL",
    acceptanceRate: "~20-25%",
    h5Index: 180,
    reviewTimeline: "2-3 months",
    dimensions: [
      {
        name: "Novelty & Significance",
        weight: 0.25,
        description: "Novel empirical NLP methods",
        criteria: NOVELTY_CRITERIA,
      },
      {
        name: "Technical Soundness",
        weight: 0.25,
        description: "Sound empirical methodology",
        criteria: TECHNICAL_CRITERIA,
      },
      {
        name: "Experimental Validation",
        weight: 0.25,
        description: "Thorough empirical evaluation with error analysis",
        criteria: {
          "9-10": "Comprehensive; multiple benchmarks; error analysis; human eval",
          "7-8": "Good experiments; some error analysis",
          "5-6": "Adequate experiments; limited analysis",
          "3-4": "Weak experiments",
          "1-2": "Insufficient",
        },
      },
      {
        name: "Presentation",
        weight: 0.10,
        description: "Clear and well-organized",
        criteria: PRESENTATION_CRITERIA,
      },
      {
        name: "Reproducibility",
        weight: 0.15,
        description: "Code and data availability",
        criteria: REPRODUCIBILITY_CRITERIA,
      },
    ],
    specialRequirements: [
      "8-page limit (excluding references)",
      "Empirical contribution expected",
      "Error analysis for NLP tasks",
    ],
    commonRejectionReasons: [
      "Insufficient empirical contribution",
      "Weak experimental evaluation",
      "Missing error analysis",
      "Incremental improvement",
    ],
    noveltyBar: "high",
  },
}

// ============================================================================
// COMBINED RUBRIC DATABASE
// ============================================================================

export const ALL_RUBRICS: Record<string, VenueRubric> = {
  ...JOURNAL_RUBRICS,
  ...CONFERENCE_RUBRICS,
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get rubric by venue name (case-insensitive partial match)
 */
export function getRubricForVenue(venueName: string): VenueRubric | undefined {
  const normalized = venueName.toLowerCase()

  // Direct match
  for (const [key, rubric] of Object.entries(ALL_RUBRICS)) {
    if (key === normalized || rubric.name.toLowerCase() === normalized) {
      return rubric
    }
  }

  // Partial match
  for (const [, rubric] of Object.entries(ALL_RUBRICS)) {
    if (
      normalized.includes(rubric.name.toLowerCase()) ||
      rubric.name.toLowerCase().includes(normalized)
    ) {
      return rubric
    }
  }

  // Publisher-based fallback
  if (normalized.includes("elsevier")) {
    return JOURNAL_RUBRICS.elsevier_information_sciences
  }
  if (normalized.includes("springer")) {
    return JOURNAL_RUBRICS.springer_machine_learning
  }
  if (normalized.includes("ieee")) {
    return JOURNAL_RUBRICS.ieee_tnnls
  }
  if (normalized.includes("acm")) {
    return JOURNAL_RUBRICS.acm_computing_surveys
  }
  if (normalized.includes("mdpi")) {
    return JOURNAL_RUBRICS.mdpi_applied_sciences
  }

  return undefined
}

/**
 * Calculate weighted score from dimension scores
 */
export function calculateWeightedScore(
  rubric: VenueRubric,
  dimensionScores: Record<string, number>,
): number {
  let totalWeight = 0
  let weightedSum = 0

  for (const dimension of rubric.dimensions) {
    const score = dimensionScores[dimension.name]
    if (score !== undefined) {
      weightedSum += score * dimension.weight
      totalWeight += dimension.weight
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

/**
 * Get recommendation based on score and venue novelty bar
 */
export function getRecommendation(
  score: number,
  noveltyBar: VenueRubric["noveltyBar"],
): { recommendation: string; confidence: string } {
  const thresholds: Record<VenueRubric["noveltyBar"], { accept: number; minor: number; major: number }> = {
    "paradigm-shifting": { accept: 9.0, minor: 8.0, major: 6.5 },
    high: { accept: 8.0, minor: 7.0, major: 5.5 },
    moderate: { accept: 7.5, minor: 6.5, major: 5.0 },
    incremental: { accept: 7.0, minor: 6.0, major: 4.5 },
  }

  const threshold = thresholds[noveltyBar]

  if (score >= threshold.accept) {
    return { recommendation: "Accept", confidence: "High" }
  } else if (score >= threshold.minor) {
    return { recommendation: "Minor Revision", confidence: "High" }
  } else if (score >= threshold.major) {
    return { recommendation: "Major Revision", confidence: "Medium" }
  } else {
    return { recommendation: "Reject", confidence: "High" }
  }
}

/**
 * Format rubric for prompt injection
 */
export function formatRubricForPrompt(rubric: VenueRubric): string {
  let output = `## ${rubric.name} (${rubric.publisher})\n`
  output += `Type: ${rubric.type}\n`
  if (rubric.impactFactor) output += `Impact Factor: ${rubric.impactFactor}\n`
  if (rubric.acceptanceRate) output += `Acceptance Rate: ${rubric.acceptanceRate}\n`
  if (rubric.h5Index) output += `h5-index: ${rubric.h5Index}\n`
  output += `Novelty Bar: ${rubric.noveltyBar}\n`
  output += `Review Timeline: ${rubric.reviewTimeline}\n\n`

  output += `### Scoring Dimensions\n\n`
  output += `| Dimension | Weight | Description |\n`
  output += `|-----------|--------|-------------|\n`
  for (const dim of rubric.dimensions) {
    output += `| ${dim.name} | ${(dim.weight * 100).toFixed(0)}% | ${dim.description} |\n`
  }

  output += `\n### Score Criteria\n\n`
  for (const dim of rubric.dimensions) {
    output += `**${dim.name}**:\n`
    for (const [range, desc] of Object.entries(dim.criteria)) {
      output += `- ${range}: ${desc}\n`
    }
    output += `\n`
  }

  output += `### Special Requirements\n\n`
  for (const req of rubric.specialRequirements) {
    output += `- ${req}\n`
  }

  output += `\n### Common Rejection Reasons\n\n`
  for (const reason of rubric.commonRejectionReasons) {
    output += `- ${reason}\n`
  }

  return output
}
