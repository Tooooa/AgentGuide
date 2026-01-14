import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, PresentationControls, useCursor, useTexture } from '@react-three/drei';
import * as THREE from 'three';

// Configuration
const PAGE_WIDTH = 3;
const PAGE_HEIGHT = 4.2;
const PAGE_DEPTH = 0.04; // Slightly thicker for better presence
const CORNER_RADIUS = 0.15; // Larger radius for more visible rounded corners
const ROUGHNESS = 0.15; // Smoother surface
const METALNESS = 0.05; // Slight metallic sheen

interface PageProps {
    number: number;
    opened: boolean;
    totalPages: number;
    frontTexture?: THREE.Texture | null;
    backTexture?: THREE.Texture | null;
}

function Page({ number, opened, totalPages, frontTexture, backTexture }: PageProps) {
    const group = useRef<THREE.Group>(null);
    const meshRef = useRef<THREE.Mesh>(null);

    useFrame((_, delta) => {
        if (!group.current) return;

        const targetRotation = opened ? -Math.PI : 0;
        const rotDiff = targetRotation - group.current.rotation.y;
        
        // Smooth easing animation
        const easing = 1 - Math.pow(1 - 0.08, delta * 60);
        group.current.rotation.y += rotDiff * easing;

        const progress = Math.max(0, Math.min(1, -group.current.rotation.y / Math.PI));
        
        // Spacing for depth
        const spacing = 0.02;
        const closedZ = (totalPages - number) * spacing;
        const openedZ = number * spacing;

        // Lift curve
        const liftHeight = 1.5;
        const lift = Math.sin(progress * Math.PI) * liftHeight;

        group.current.position.z = THREE.MathUtils.lerp(closedZ, openedZ, progress) + lift;
    });

    const isCover = number === 0;

    // Create rounded corner mask
    const roundedMask = useMemo(() => {
        const canvas = document.createElement('canvas');
        const size = 1024;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const r = (CORNER_RADIUS / PAGE_WIDTH) * size;
        
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, size, size);
        
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(size - r, 0);
        ctx.quadraticCurveTo(size, 0, size, r);
        ctx.lineTo(size, size - r);
        ctx.quadraticCurveTo(size, size, size - r, size);
        ctx.lineTo(r, size);
        ctx.quadraticCurveTo(0, size, 0, size - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }, []);

    // Define materials array
    const materialArray = useMemo(() => {
        // Edge material - light gray for paper edges
        const sideMat = new THREE.MeshStandardMaterial({ 
            color: '#F5F5F5',
            roughness: 0.4,
            metalness: 0.0
        });

        // FRONT face
        let frontMat;
        if (frontTexture) {
            frontMat = new THREE.MeshStandardMaterial({
                map: frontTexture,
                alphaMap: roundedMask,
                transparent: true,
                roughness: isCover ? 0.2 : ROUGHNESS,
                metalness: isCover ? 0.1 : METALNESS,
                color: '#ffffff'
            });
        } else {
            frontMat = new THREE.MeshStandardMaterial({
                color: '#FFFFFF',
                alphaMap: roundedMask,
                transparent: true,
                roughness: ROUGHNESS,
                metalness: METALNESS
            });
        }

        // BACK face
        let backMat;
        if (backTexture) {
            backMat = new THREE.MeshStandardMaterial({
                map: backTexture,
                alphaMap: roundedMask,
                transparent: true,
                roughness: ROUGHNESS,
                metalness: METALNESS,
                color: '#ffffff'
            });
        } else {
            backMat = new THREE.MeshStandardMaterial({ 
                color: '#FFFFFF',
                alphaMap: roundedMask,
                transparent: true,
                roughness: ROUGHNESS,
                metalness: METALNESS
            });
        }

        return [sideMat, sideMat, sideMat, sideMat, frontMat, backMat];
    }, [isCover, frontTexture, backTexture, roundedMask]);

    return (
        <group ref={group}>
            <group position={[PAGE_WIDTH / 2, 0, 0]}>
                {/* Main page */}
                <mesh ref={meshRef} material={materialArray} castShadow receiveShadow>
                    <boxGeometry args={[PAGE_WIDTH, PAGE_HEIGHT, isCover ? PAGE_DEPTH * 1.5 : PAGE_DEPTH]} />
                </mesh>
            </group>
        </group>
    );
}

const Book = ({ pageIndex, setTotalPages, setCurrentPage }: { pageIndex: number, setTotalPages: (n: number) => void, setCurrentPage: (n: number) => void }) => {
    const [hovered, setHover] = useState(false);
    useCursor(hovered);

    // Load cover
    const coverTexture = useTexture('/book_cover.png');
    coverTexture.colorSpace = THREE.SRGBColorSpace;

    // Load all spread textures (01-10)
    const spreadTextures = useTexture([
        '/book_spread_01.png',
        '/book_spread_02.png',
        '/book_spread_03.png',
        '/book_spread_04.png',
        '/book_spread_05.png',
        '/book_spread_06.png',
        '/book_spread_07.png',
        '/book_spread_08.png',
        '/book_spread_09.png',
        '/book_spread_10.png',
    ]);
    
    // Set color space for all spreads
    spreadTextures.forEach(tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
    });

    // Load last page
    const lastTexture = useTexture('/book_last.png');
    lastTexture.colorSpace = THREE.SRGBColorSpace;

    // Split each spread into left and right halves
    const spreads = useMemo(() => {
        return spreadTextures.map(spreadTexture => {
            const left = spreadTexture.clone();
            left.colorSpace = THREE.SRGBColorSpace;
            left.offset.set(0, 0);
            left.repeat.set(0.5, 1);
            left.needsUpdate = true;

            const right = spreadTexture.clone();
            right.colorSpace = THREE.SRGBColorSpace;
            right.offset.set(0.5, 0);
            right.repeat.set(0.5, 1);
            right.needsUpdate = true;

            return { left, right };
        });
    }, [spreadTextures]);

    // Split last page into left and right halves
    const lastSpread = useMemo(() => {
        const left = lastTexture.clone();
        left.colorSpace = THREE.SRGBColorSpace;
        left.offset.set(0, 0);
        left.repeat.set(0.5, 1);
        left.needsUpdate = true;

        const right = lastTexture.clone();
        right.colorSpace = THREE.SRGBColorSpace;
        right.offset.set(0.5, 0);
        right.repeat.set(0.5, 1);
        right.needsUpdate = true;

        return { left, right };
    }, [lastTexture]);

    // Total pages structure:
    // Page 0: Cover (front=cover, back=white)
    // Pages 1-20: 10 spreads × 2 pages each
    // Pages 21-22: Last spread × 2 pages
    const totalPages = 22; // Cover + (10 spreads × 2) + (last spread × 2)
    
    useEffect(() => {
        setTotalPages(11); // 0=cover, 1-10=spreads, 11=last spread
        setCurrentPage(pageIndex);
    }, [pageIndex, setTotalPages, setCurrentPage]);

    // Build all pages
    const allPages = [];
    
    // Cover page (page 0) - flips when we go to any spread
    allPages.push(
        <Page
            key={0}
            number={0}
            totalPages={totalPages}
            opened={pageIndex >= 1}
            frontTexture={coverTexture}
            backTexture={null}
        />
    );
    
    // Spread pages (pages 1-20)
    spreads.forEach((spread, spreadIndex) => {
        const leftPageNumber = spreadIndex * 2 + 1;
        const rightPageNumber = spreadIndex * 2 + 2;
        const spreadNumber = spreadIndex + 1; // spread 1, 2, 3, etc.
        
        // Left page: flips when we reach or pass this spread
        // When at spreadNumber, left page is flipped showing its back (left half)
        allPages.push(
            <Page
                key={leftPageNumber}
                number={leftPageNumber}
                totalPages={totalPages}
                opened={pageIndex >= spreadNumber}
                frontTexture={null}
                backTexture={spread.left}
            />
        );
        
        // Right page: stays unflipped when viewing this spread, flips when we move past
        // When at spreadNumber, right page shows its front (right half)
        allPages.push(
            <Page
                key={rightPageNumber}
                number={rightPageNumber}
                totalPages={totalPages}
                opened={pageIndex > spreadNumber}
                frontTexture={spread.right}
                backTexture={null}
            />
        );
    });
    
    // Last spread (pages 21-22) - shows when pageIndex=11
    // Left page of last spread
    allPages.push(
        <Page
            key={21}
            number={21}
            totalPages={totalPages}
            opened={pageIndex >= 11}
            frontTexture={null}
            backTexture={lastSpread.left}
        />
    );
    
    // Right page of last spread
    allPages.push(
        <Page
            key={22}
            number={22}
            totalPages={totalPages}
            opened={pageIndex > 11}
            frontTexture={lastSpread.right}
            backTexture={null}
        />
    );

    return (
        <group
            onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
            onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}
        >
            {allPages}
        </group>
    );
};

export default function BookDemo({ onBack }: { onBack: () => void }) {
    const [totalPages, setTotalPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(0);

    const handleNext = () => {
        if (currentPage < totalPages) {
            setCurrentPage(prev => prev + 1);
        }
    };

    const handlePrev = () => {
        if (currentPage > 0) {
            setCurrentPage(prev => prev - 1);
        }
    };

    return (
        <div className="w-full h-screen bg-slate-900 relative overflow-hidden font-sans">
            {/* Dark background with subtle gradients */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-slate-800/30 rounded-full blur-3xl" />
                <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] bg-slate-700/20 rounded-full blur-3xl" />
            </div>

            <button
                onClick={onBack}
                className="absolute top-8 left-8 z-50 text-slate-400 hover:text-slate-100 transition-colors flex items-center gap-2 font-medium"
            >
                ← Back
            </button>

            {/* Enhanced page indicator */}
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-800/70 backdrop-blur-lg px-8 py-4 rounded-full shadow-lg border border-slate-700/60 transition-all duration-300">
                {new Array(totalPages + 1).fill(0).map((_, i) => (
                    <div
                        key={i}
                        onClick={() => setCurrentPage(i)}
                        className={`
                            rounded-full transition-all duration-300 cursor-pointer
                            ${i === currentPage
                                ? 'w-3 h-3 bg-gradient-to-r from-indigo-400 to-purple-400 scale-125 shadow-lg shadow-indigo-500/50'
                                : 'w-2 h-2 bg-slate-600 hover:bg-slate-400 hover:scale-110'
                            }
                        `}
                    />
                ))}
            </div>
            
            {/* Invisible click areas for navigation */}
            <div 
                className="absolute left-0 top-0 w-1/2 h-full z-40 cursor-pointer group"
                onClick={handlePrev}
                title="Previous Page"
            >
                {/* Visual indicator on hover */}
                <div className="absolute left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="bg-slate-800/90 backdrop-blur-md rounded-full p-3 shadow-lg border border-slate-700">
                        <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </div>
                </div>
            </div>
            <div 
                className="absolute right-0 top-0 w-1/2 h-full z-40 cursor-pointer group"
                onClick={handleNext}
                title="Next Page"
            >
                {/* Visual indicator on hover */}
                <div className="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="bg-slate-800/90 backdrop-blur-md rounded-full p-3 shadow-lg border border-slate-700">
                        <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>
            </div>

            <Canvas shadows camera={{ position: [0, 0, 8.5], fov: 35 }}>
                {/* Enhanced lighting setup for premium look */}
                <ambientLight intensity={0.6} />
                
                {/* Main directional light with soft shadows */}
                <directionalLight 
                    position={[5, 8, 5]} 
                    intensity={1.5} 
                    castShadow
                    shadow-mapSize-width={4096}
                    shadow-mapSize-height={4096}
                    shadow-camera-far={50}
                    shadow-camera-left={-10}
                    shadow-camera-right={10}
                    shadow-camera-top={10}
                    shadow-camera-bottom={-10}
                    shadow-bias={-0.0001}
                />
                
                {/* Fill lights for softer shadows */}
                <pointLight position={[-5, 5, -5]} intensity={0.4} color="#e0e7ff" />
                <pointLight position={[5, -3, 5]} intensity={0.3} color="#fef3c7" />
                
                {/* Rim light for edge definition */}
                <spotLight 
                    position={[0, 10, -5]} 
                    angle={0.4} 
                    penumbra={1} 
                    intensity={0.6} 
                    color="#ffffff"
                    castShadow
                />

                <PresentationControls
                    global
                    rotation={[0, 0, 0]}
                    polar={[-Math.PI / 12, Math.PI / 12]}
                    azimuth={[-Math.PI / 6, Math.PI / 6]}
                >
                    <Float
                        rotationIntensity={0.1}
                        floatIntensity={0.2}
                        speed={1.2}
                        floatingRange={[-0.03, 0.03]}
                    >
                        <React.Suspense fallback={null}>
                            <Book pageIndex={currentPage} setTotalPages={setTotalPages} setCurrentPage={setCurrentPage} />
                        </React.Suspense>
                    </Float>
                </PresentationControls>

                {/* Premium environment with soft lighting */}
                <Environment preset="apartment" />
                
                {/* Subtle fog for depth */}
                <fog attach="fog" args={['#0f172a', 12, 25]} />
            </Canvas>
        </div>
    );
}
