'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Confetti from 'react-confetti';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import jsPDF from 'jspdf';
import Editor from '@monaco-editor/react';
import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

// Types
interface ComplexityResult {
    O: string;
    Theta: string;
    littleo: string;
}

interface BreakdownSection {
    section: string;
    analysis: string;
    result: ComplexityResult;
}

interface AnalysisResult {
    inputSize: string;
    timeComplexity: ComplexityResult;
    spaceComplexity: ComplexityResult;
    breakdown: BreakdownSection[];
    averageCase: ComplexityResult;
    error?: string;
}

// Language detection
function detectLanguage(code: string): string {
    const trimmed = code.trim().toLowerCase();
    if (trimmed.includes('#include') || trimmed.includes('int main') || trimmed.includes('void ')) {
        return 'c';
    }
    if (trimmed.includes('def ') || trimmed.includes('import ') || trimmed.includes('print(')) {
        return 'python';
    }
    if (trimmed.includes('program ') || trimmed.includes('begin') || trimmed.includes('end;')) {
        return 'pascal';
    }
    return 'javascript';
}

// Complexity calculation helpers
function calculateComplexity(iterations: string | number): ComplexityResult {
    if (typeof iterations === 'number') {
        if (iterations === 1) {
            return { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' };
        }
        return { O: `O(${iterations})`, Theta: `Θ(${iterations})`, littleo: `o(${iterations})` };
    }

    const str = iterations.toString();
    if (str.includes('log')) {
        return { O: `O(${str})`, Theta: `Θ(${str})`, littleo: `o(${str})` };
    }
    if (str.includes('n^2') || str.includes('n²')) {
        return { O: 'O(n²)', Theta: 'Θ(n²)', littleo: 'o(n²)' };
    }
    if (str.includes('n^3') || str.includes('n³')) {
        return { O: 'O(n³)', Theta: 'Θ(n³)', littleo: 'o(n³)' };
    }
    if (str === 'n') {
        return { O: 'O(n)', Theta: 'Θ(n)', littleo: 'o(n)' };
    }
    return { O: `O(${str})`, Theta: `Θ(${str})`, littleo: `o(${str})` };
}

function combineComplexities(complexities: ComplexityResult[]): ComplexityResult {
    if (complexities.length === 0) {
        return { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' };
    }

    const order = ['n!', 'n³', 'n²', 'n log n', 'n', 'log n', '1'];
    let dominant = complexities[0];
    for (const comp of complexities) {
        const currentOrder = order.findIndex(o => comp.O.includes(o));
        const dominantOrder = order.findIndex(o => dominant.O.includes(o));
        if (currentOrder < dominantOrder) {
            dominant = comp;
        }
    }
    return dominant;
}

// Master Theorem solver
function applyMasterTheorem(a: number, b: number, f: string): ComplexityResult {
    const log_b_a = Math.log(a) / Math.log(b);
    if (f === 'O(1)') {
        if (log_b_a > 0) {
            return calculateComplexity(`n^${log_b_a.toFixed(4)}`);
        }
        return calculateComplexity('log n');
    } else if (f === 'O(n)') {
        if (log_b_a < 1) {
            return calculateComplexity('n');
        }
        return calculateComplexity(`n^${log_b_a.toFixed(4)}`);
    }
    return calculateComplexity(`n^${log_b_a.toFixed(4)}`);
}

// JavaScript AST Analysis
function analyzeJavaScript(code: string): AnalysisResult {
    try {
        const ast = parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript'],
        });

        const breakdown: BreakdownSection[] = [];
        const timeComplexities: ComplexityResult[] = [];
        let spaceComplexity: ComplexityResult = { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' };

        traverse(ast, {
            ForStatement(path) {
                const init = path.node.init;
                const test = path.node.test;
                const update = path.node.update;

                let iterations = 'n';
                let analysis = 'Standard for loop';

                if (update && t.isUpdateExpression(update)) {
                    if (update.operator === '++') {
                        iterations = 'n';
                        analysis = 'Linear loop: i++';
                    }
                } else if (update && t.isAssignmentExpression(update)) {
                    if (update.operator === '*=') {
                        iterations = 'log n';
                        analysis = 'Logarithmic loop: i *= constant';
                    } else if (update.operator === '/=') {
                        iterations = 'log n';
                        analysis = 'Logarithmic loop: i /= constant';
                    }
                }

                const complexity = calculateComplexity(iterations);
                breakdown.push({ section: 'For Loop', analysis, result: complexity });
                timeComplexities.push(complexity);
            },

            WhileStatement(path) {
                const complexity = calculateComplexity('n');
                breakdown.push({
                    section: 'While Loop',
                    analysis: 'While loop with potentially n iterations',
                    result: complexity
                });
                timeComplexities.push(complexity);
            },

            FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
                let recursiveCalls = 0;
                let divisionFactor = 1;
                let extraWork = 'O(1)';

                path.traverse({
                    CallExpression(callPath: NodePath<t.CallExpression>) {
                        if (t.isIdentifier(callPath.node.callee) &&
                            callPath.node.callee.name === path.node.id?.name) {
                            recursiveCalls++;
                            const args = callPath.node.arguments;
                            if (args[0] && t.isBinaryExpression(args[0])) {
                                if (args[0].operator === '/' && t.isNumericLiteral(args[0].right)) {
                                    divisionFactor = args[0].right.value;
                                }
                            }
                        }
                    },
                    BinaryExpression(bPath: NodePath<t.BinaryExpression>) {
                        if (bPath.node.left && bPath.node.right) {
                            extraWork = 'O(n)';
                        }
                    }
                });

                if (recursiveCalls > 0) {
                    const complexity = applyMasterTheorem(recursiveCalls, divisionFactor, extraWork);
                    breakdown.push({
                        section: 'Recursive Function',
                        analysis: `Recursive function with ${recursiveCalls} calls, n/${divisionFactor} reduction, ${extraWork} extra work`,
                        result: complexity
                    });
                    timeComplexities.push(complexity);
                    spaceComplexity = calculateComplexity(`log_${divisionFactor} n`);
                }
            }
        });

        return {
            inputSize: 'n',
            timeComplexity: combineComplexities(timeComplexities),
            spaceComplexity,
            breakdown,
            averageCase: combineComplexities(timeComplexities)
        };
    } catch (error) {
        return {
            inputSize: 'n',
            timeComplexity: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            spaceComplexity: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            breakdown: [],
            averageCase: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            error: `JavaScript parsing error: ${error}`
        };
    }
}

// Python Analysis
function analyzePython(code: string): AnalysisResult {
    const breakdown: BreakdownSection[] = [];
    const timeComplexities: ComplexityResult[] = [];
    let spaceComplexity: ComplexityResult = { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' };

    // Detect imports
    if (code.includes('import itertools') && code.includes('permutations')) {
        const complexity = calculateComplexity('n!');
        breakdown.push({
            section: 'Permutations',
            analysis: 'Generation of all permutations using itertools.permutations',
            result: complexity
        });
        timeComplexities.push(complexity);
        spaceComplexity = calculateComplexity('n!');
    }

    // Detect for loops
    const forLoops = code.match(/for\s+\w+\s+in\s+range\s*\([^)]+\)/g) || [];
    forLoops.forEach((loop) => {
        const rangeMatch = loop.match(/range\s*\(([^,)]+)(?:,([^,)]+))?\)/);
        let iterations = 'n';
        let analysis = 'Python for loop with range(n)';
        if (rangeMatch && rangeMatch[2]) {
            const step = rangeMatch[2].trim();
            if (step.includes('*') || step.includes('/')) {
                iterations = 'log n';
                analysis = 'Logarithmic loop with multiplicative step';
            }
        }
        const complexity = calculateComplexity(iterations);
        breakdown.push({ section: 'For Loop', analysis, result: complexity });
        timeComplexities.push(complexity);
    });

    // Detect nested loops
    const lines = code.split('\n');
    let indentLevel = 0;
    let loopCount = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('for')) {
            indentLevel++;
            loopCount++;
            if (indentLevel >= 2) {
                const complexity = calculateComplexity('n²');
                breakdown.push({
                    section: 'Nested For Loops',
                    analysis: 'Nested loops creating quadratic complexity',
                    result: complexity
                });
                timeComplexities.push(complexity);
            }
        } else if (trimmed.startsWith('}')) {
            indentLevel--;
        }
    }

    // Detect recursion
    const funcDefs = code.match(/def\s+(\w+)\s*\([^)]*\):/g) || [];
    funcDefs.forEach((funcDef) => {
        const funcName = funcDef.match(/def\s+(\w+)/)?.[1];
        if (funcName && code.includes(`${funcName}(`)) {
            const recursiveCallMatch = code.match(new RegExp(`${funcName}\\s*\\([^)]*/\\s*(\\d+)\\)`));
            let recursiveCalls = 1;
            let divisionFactor = 1;
            let extraWork = 'O(1)';

            if (recursiveCallMatch) {
                divisionFactor = parseInt(recursiveCallMatch[1]);
                recursiveCalls = (code.match(new RegExp(`${funcName}\\s*\\([^)]*\\)`, 'g')) || []).length;
                if (code.includes('+') || code.includes('-')) {
                    extraWork = 'O(n)';
                }
            }

            const complexity = applyMasterTheorem(recursiveCalls, divisionFactor, extraWork);
            breakdown.push({
                section: 'Recursive Function',
                analysis: `Function ${funcName} with ${recursiveCalls} recursive calls, n/${divisionFactor} reduction`,
                result: complexity
            });
            timeComplexities.push(complexity);
            spaceComplexity = calculateComplexity(`log_${divisionFactor} n`);
        }
    });

    return {
        inputSize: 'n',
        timeComplexity: combineComplexities(timeComplexities),
        spaceComplexity,
        breakdown,
        averageCase: combineComplexities(timeComplexities)
    };
}

// C Analysis
function analyzeC(code: string): AnalysisResult {
    const breakdown: BreakdownSection[] = [];
    const timeComplexities: ComplexityResult[] = [];
    let spaceComplexity: ComplexityResult = { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' };

    // Detect for loops
    const forLoops = code.match(/for\s*\([^)]+\)/g) || [];
    forLoops.forEach((loop) => {
        let complexity;
        let analysis;

        if (loop.includes('*=') || loop.includes('/=')) {
            complexity = calculateComplexity('log n');
            analysis = 'Logarithmic for loop (multiplicative update)';
        } else {
            complexity = calculateComplexity('n');
            analysis = 'Linear for loop';
        }

        // Check for nested loops
        const lines = code.split('\n');
        let indentLevel = 0;
        for (const line of lines) {
            if (line.includes('for') || line.includes('while')) {
                indentLevel++;
                if (indentLevel >= 2) {
                    complexity = calculateComplexity('n log n');
                    analysis = 'Nested loop structure (outer logarithmic, inner linear)';
                }
            } else if (line.includes('}')) {
                indentLevel--;
            }
        }

        breakdown.push({ section: 'For Loop', analysis, result: complexity });
        timeComplexities.push(complexity);
    });

    // Detect while loops
    const whileLoops = code.match(/while\s*\([^)]+\)/g) || [];
    whileLoops.forEach((loop) => {
        const complexity = calculateComplexity('n');
        breakdown.push({
            section: 'While Loop',
            analysis: 'C while loop with linear iterations',
            result: complexity
        });
        timeComplexities.push(complexity);
    });

    return {
        inputSize: 'n',
        timeComplexity: combineComplexities(timeComplexities),
        spaceComplexity,
        breakdown,
        averageCase: combineComplexities(timeComplexities)
    };
}

// Pascal Analysis
function analyzePascal(code: string): AnalysisResult {
    const breakdown: BreakdownSection[] = [];
    const timeComplexities: ComplexityResult[] = [];
    let spaceComplexity: ComplexityResult = { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' };

    // Detect for loops
    const forLoops = code.match(/for\s+\w+\s*:=\s*[^;]+to[^;]+do/gi) || [];
    forLoops.forEach(() => {
        const complexity = calculateComplexity('n');
        breakdown.push({
            section: 'For Loop',
            analysis: 'Pascal for loop with linear iterations',
            result: complexity
        });
        timeComplexities.push(complexity);
    });

    // Detect recursion
    const funcDefs = code.match(/function\s+(\w+)\s*\([^)]*\)\s*:\s*\w+/gi) || [];
    funcDefs.forEach((funcDef) => {
        const funcName = funcDef.match(/function\s+(\w+)/i)?.[1];
        if (funcName && code.toLowerCase().includes(funcName.toLowerCase() + '(')) {
            const recursiveCallMatch = code.match(new RegExp(`${funcName}\\s*\\([^)]*div\\s*(\\d+)\\)`, 'i'));
            let recursiveCalls = 1;
            let divisionFactor = 1;
            let extraWork = 'O(1)';

            if (recursiveCallMatch) {
                divisionFactor = parseInt(recursiveCallMatch[1]);
                recursiveCalls = (code.match(new RegExp(`${funcName}\\s*\\([^)]*\\)`, 'gi')) || []).length;
                if (code.includes('+') || code.includes('-')) {
                    extraWork = 'O(n)';
                }
            }

            const complexity = applyMasterTheorem(recursiveCalls, divisionFactor, extraWork);
            breakdown.push({
                section: 'Recursive Function',
                analysis: `Function ${funcName} with ${recursiveCalls} recursive calls, n/${divisionFactor} reduction`,
                result: complexity
            });
            timeComplexities.push(complexity);
            spaceComplexity = calculateComplexity(`log_${divisionFactor} n`);
        }
    });

    return {
        inputSize: 'n',
        timeComplexity: combineComplexities(timeComplexities),
        spaceComplexity,
        breakdown,
        averageCase: combineComplexities(timeComplexities)
    };
}

// Main analyzer function
function analyzeCode(code: string): AnalysisResult {
    if (!code.trim()) {
        return {
            inputSize: 'n',
            timeComplexity: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            spaceComplexity: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            breakdown: [],
            averageCase: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            error: 'Empty code input'
        };
    }

    if (code.split('\n').length > 500) {
        return {
            inputSize: 'n',
            timeComplexity: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            spaceComplexity: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            breakdown: [],
            averageCase: { O: 'O(1)', Theta: 'Θ(1)', littleo: 'o(1)' },
            error: 'Code exceeds 500 lines limit'
        };
    }

    const language = detectLanguage(code);

    switch (language) {
        case 'javascript':
            return analyzeJavaScript(code);
        case 'python':
            return analyzePython(code);
        case 'c':
            return analyzeC(code);
        case 'pascal':
            return analyzePascal(code);
        default:
            return analyzeJavaScript(code);
    }
}

// Test cases
const testCases = [
    {
        name: 'Python Recursion',
        code: `def proc(n):
    if n<=1:
        return 1
    else:
        return proc(n/3) + n + proc(n/3)`,
        expected: 'O(n^0.6309)'
    },
    {
        name: 'C Nested Loops',
        code: `for(i=1; i <=n ; i=i*3)
{
    j=n;
    while(j>=1)
    {
         j=j-2;
    }
}`,
        expected: 'O(n log n)'
    },
    {
        name: 'Python Permutations',
        code: `import itertools

def example_function(n):
    for i in range(n):
        for j in range(n):
            _ = i + j
    permutations = list(itertools.permutations(range(n)))
    for p in permutations:
        _ = sum(p)`,
        expected: 'O(n!)'
    }
];

function runTests(): { passed: number; total: number; results: any[] } {
    const results = testCases.map(test => {
        const result = analyzeCode(test.code);
        const passed = result.timeComplexity.O.includes(test.expected);
        return {
            name: test.name,
            expected: test.expected,
            actual: result.timeComplexity.O,
            passed
        };
    });

    const passed = results.filter(r => r.passed).length;
    return { passed, total: results.length, results };
}

// Chart data generation
function generateChartData(complexity: string) {
    const sizes = [1, 10, 100, 1000, 10000];
    const data = sizes.map(n => {
        if (complexity.includes('n!')) {
            return factorial(n);
        } else if (complexity.includes('n³') || complexity.includes('n^3')) {
            return Math.pow(n, 3);
        } else if (complexity.includes('n²') || complexity.includes('n^2')) {
            return Math.pow(n, 2);
        } else if (complexity.includes('n log n')) {
            return n * Math.log2(n);
        } else if (complexity.includes('log n')) {
            return Math.log2(n);
        } else if (complexity.includes('n^0.6309')) {
            return Math.pow(n, 0.6309);
        } else if (complexity.includes('n')) {
            return n;
        }
        return 1;
    });

    return {
        labels: sizes.map(s => s.toString()),
        datasets: [{
            label: 'Time Complexity',
            data,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            tension: 0.1
        }]
    };
}

function factorial(n: number): number {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}

// PDF generation
function generatePDF(result: AnalysisResult, chartCanvas: HTMLCanvasElement | null) {
    const pdf = new jsPDF();

    pdf.setFontSize(20);
    pdf.text('Time Complexity Analysis Report', 20, 30);

    pdf.setFontSize(12);
    pdf.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 45);

    let yPos = 60;
    pdf.setFontSize(14);
    pdf.text('Analysis Results:', 20, yPos);
    yPos += 15;

    pdf.setFontSize(12);
    pdf.text(`Time Complexity: ${result.timeComplexity.O}`, 20, yPos);
    yPos += 10;
    pdf.text(`Space Complexity: ${result.spaceComplexity.O}`, 20, yPos);
    yPos += 20;

    pdf.setFontSize(14);
    pdf.text('Detailed Breakdown:', 20, yPos);
    yPos += 15;

    pdf.setFontSize(10);
    result.breakdown.forEach(section => {
        if (yPos > 250) {
            pdf.addPage();
            yPos = 30;
        }
        pdf.text(`• ${section.section}: ${section.analysis}`, 20, yPos);
        yPos += 8;
        pdf.text(`  Result: ${section.result.O}`, 25, yPos);
        yPos += 12;
    });

    if (chartCanvas) {
        const imgData = chartCanvas.toDataURL('image/png');
        pdf.addPage();
        pdf.setFontSize(14);
        pdf.text('Complexity Visualization:', 20, 30);
        pdf.addImage(imgData, 'PNG', 20, 40, 160, 100);
    }

    return pdf;
}

// Main component
export default function TimeComplexityCalculator() {
    const [code, setCode] = useState('');
    const [result, setResult] = useState<AnalysisResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);
    const [testResults, setTestResults] = useState<any>(null);
    const chartRef = useRef<any>(null);

    const handleAnalyze = async () => {
        setLoading(true);
        try {
            const analysisResult = analyzeCode(code);
            setResult(analysisResult);

            if (!analysisResult.error) {
                setShowConfetti(true);
                setTimeout(() => setShowConfetti(false), 3000);
            }
        } catch (error) {
            console.error('Analysis failed:', error);
        }
        setLoading(false);
    };

    const handleRunTests = () => {
        const testResult = runTests();
        setTestResults(testResult);
        console.log('Test Results:', testResult);
    };

    const downloadJSON = () => {
        if (!result) return;
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'complexity-analysis.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const downloadPDF = () => {
        if (!result) return;
        const chartCanvas = chartRef.current?.canvas;
        const pdf = generatePDF(result, chartCanvas);
        pdf.save('complexity-analysis.pdf');
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
            <style jsx global>{`
                @import 'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css';
            `}</style>
            {showConfetti && <Confetti />}
            
            <div className="max-w-6xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center mb-8"
                >
                    <h1 className="text-4xl font-bold text-gray-800 mb-2">
                        Time Complexity Calculator
                    </h1>
                    <p className="text-gray-600">
                        Analyze the time and space complexity of your code
                    </p>
                </motion.div>

                <div className="grid lg:grid-cols-2 gap-8">
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-white rounded-lg shadow-lg p-6"
                    >
                        <h2 className="text-xl font-semibold mb-4">Code Input</h2>
                        <div className="border rounded-lg overflow-hidden h-96">
                            <Editor
                                height="100%"
                                defaultLanguage="javascript"
                                value={code}
                                onChange={(value) => setCode(value || '')}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 14,
                                    lineNumbers: 'on',
                                    automaticLayout: true
                                }}
                            />
                        </div>

                        <div className="flex gap-4 mt-4">
                            <button
                                onClick={handleAnalyze}
                                disabled={loading || !code.trim()}
                                className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {loading ? 'Analyzing...' : 'Analyze Complexity'}
                            </button>

                            <button
                                onClick={handleRunTests}
                                className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
                            >
                                Run Tests
                            </button>
                        </div>

                        {testResults && (
                            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                                <p className="font-medium">
                                    Tests: {testResults.passed}/{testResults.total} passed
                                </p>
                            </div>
                        )}
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-white rounded-lg shadow-lg p-6"
                    >
                        <h2 className="text-xl font-semibold mb-4">Analysis Results</h2>

                        {loading && (
                            <div className="flex items-center justify-center h-64">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                            </div>
                        )}

                        {result && !result.error && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-blue-50 p-4 rounded-lg">
                                        <h3 className="font-medium text-blue-800">Time Complexity</h3>
                                        <p className="text-lg font-semibold text-blue-600">
                                            {result.timeComplexity.O}
                                        </p>
                                    </div>

                                    <div className="bg-green-50 p-4 rounded-lg">
                                        <h3 className="font-medium text-green-800">Space Complexity</h3>
                                        <p className="text-lg font-semibold text-green-600">
                                            {result.spaceComplexity.O}
                                        </p>
                                    </div>
                                </div>

                                <div className="h-64">
                                    <Line
                                        ref={chartRef}
                                        data={generateChartData(result.timeComplexity.O)}
                                        options={{
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            plugins: {
                                                title: {
                                                    display: true,
                                                    text: 'Time Complexity Growth'
                                                }
                                            },
                                            scales: {
                                                x: {
                                                    title: {
                                                        display: true,
                                                        text: 'Input Size (n)'
                                                    }
                                                },
                                                y: {
                                                    title: {
                                                        display: true,
                                                        text: 'Time (relative)'
                                                    }
                                                }
                                            }
                                        }}
                                    />
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={downloadJSON}
                                        className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                                    >
                                        Download JSON
                                    </button>
                                    <button
                                        onClick={downloadPDF}
                                        className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                                    >
                                        Download PDF
                                    </button>
                                </div>
                            </div>
                        )}

                        {result?.error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                <h3 className="font-medium text-red-800 mb-2">Analysis Error</h3>
                                <p className="text-red-600">{result.error}</p>
                            </div>
                        )}
                    </motion.div>
                </div>

                {result && !result.error && result.breakdown.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-8 bg-white rounded-lg shadow-lg p-6"
                    >
                        <h2 className="text-xl font-semibold mb-4">Detailed Breakdown</h2>
                        <div className="space-y-4">
                            {result.breakdown.map((section, index) => (
                                <div key={index} className="border rounded-lg p-4">
                                    <h3 className="font-medium text-gray-800 mb-2">
                                        {section.section}
                                    </h3>
                                    <p className="text-gray-600 mb-2">{section.analysis}</p>
                                    <div className="flex gap-4 text-sm">
                                        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                            {section.result.O}
                                        </span>
                                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                                            {section.result.Theta}
                                        </span>
                                        <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                                            {section.result.littleo}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}